// api/gamification/badges/award.js
// API para conceder distintivos aos usuários

const { query, transaction, getUserById, addPointsToUser } = require('../utils/database');
const { 
  authenticateUser, 
  validateRequiredParams, 
  validateDataTypes,
  sanitizeInput,
  createResponse, 
  handleError, 
  handleCors 
} = require('../utils/auth');

module.exports = async (req, res) => {
  try {
    // Lidar com CORS preflight
    const corsResponse = handleCors(req);
    if (corsResponse) return res.status(corsResponse.statusCode).json(corsResponse);
    
    // Verificar método HTTP
    if (req.method !== 'POST') {
      return res.status(405).json(createResponse(false, null, 'Método não permitido', 405));
    }
    
    // Autenticar usuário ou verificar API key
    const auth = authenticateUser(req);
    
    // Sanitizar entrada
    const body = sanitizeInput(req.body);
    
    // Validar parâmetros obrigatórios
    const requiredFields = ['userId', 'badgeId'];
    validateRequiredParams(body, requiredFields);
    
    // Validar tipos de dados
    validateDataTypes(body, {
      userId: 'integer',
      badgeId: 'integer',
      reason: 'string'
    });
    
    const { userId, badgeId, reason } = body;
    
    // Verificar se o usuário existe
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createResponse(false, null, 'Usuário não encontrado', 404));
    }
    
    // Verificar se o distintivo existe e está ativo
    const badgeResult = await query(`
      SELECT id, name, description, icon_url, criteria, points_reward, is_active
      FROM badges 
      WHERE id = $1 AND is_active = true
    `, [badgeId]);
    
    if (badgeResult.rows.length === 0) {
      return res.status(404).json(createResponse(false, null, 'Distintivo não encontrado ou inativo', 404));
    }
    
    const badge = badgeResult.rows[0];
    
    // Verificar se o usuário já possui este distintivo
    const existingBadgeResult = await query(`
      SELECT id, earned_at 
      FROM user_badges 
      WHERE user_id = $1 AND badge_id = $2
    `, [userId, badgeId]);
    
    if (existingBadgeResult.rows.length > 0) {
      return res.status(400).json(createResponse(false, null, 'Usuário já possui este distintivo', 400));
    }
    
    // Verificar autorização (apenas chamadas internas podem conceder distintivos diretamente)
    if (!auth.isInternal) {
      return res.status(403).json(createResponse(false, null, 'Apenas chamadas internas podem conceder distintivos', 403));
    }
    
    try {
      // Iniciar transação para conceder o distintivo e adicionar pontos
      const queries = [
        // Conceder o distintivo
        {
          text: `INSERT INTO user_badges (user_id, badge_id, earned_at) 
                 VALUES ($1, $2, CURRENT_TIMESTAMP)`,
          params: [userId, badgeId]
        }
      ];
      
      await transaction(queries);
      
      // Adicionar pontos se o distintivo tiver recompensa em pontos
      let pointsResult = null;
      if (badge.points_reward > 0) {
        pointsResult = await addPointsToUser(
          userId,
          badge.points_reward,
          'badge',
          reason || `Distintivo conquistado: ${badge.name}`,
          null
        );
      }
      
      // Obter informações atualizadas do distintivo concedido
      const awardedBadgeResult = await query(`
        SELECT 
          ub.id,
          ub.earned_at,
          b.name,
          b.description,
          b.icon_url,
          b.criteria,
          b.points_reward
        FROM user_badges ub
        JOIN badges b ON ub.badge_id = b.id
        WHERE ub.user_id = $1 AND ub.badge_id = $2
      `, [userId, badgeId]);
      
      const awardedBadge = awardedBadgeResult.rows[0];
      
      // Verificar se este distintivo desbloqueia outros distintivos ou conquistas
      const unlockedContent = await checkUnlockedContent(userId, badgeId);
      
      // Preparar resposta
      const responseData = {
        userId,
        badge: {
          id: badgeId,
          name: awardedBadge.name,
          description: awardedBadge.description,
          iconUrl: awardedBadge.icon_url,
          criteria: JSON.parse(awardedBadge.criteria),
          pointsReward: awardedBadge.points_reward,
          earnedAt: awardedBadge.earned_at
        },
        pointsAwarded: badge.points_reward,
        newTotalPoints: pointsResult ? pointsResult.newTotal : null,
        currentLevel: pointsResult ? pointsResult.currentLevel : null,
        pointsToNextLevel: pointsResult ? pointsResult.pointsToNextLevel : null,
        reason: reason || `Distintivo conquistado: ${badge.name}`,
        unlockedContent
      };
      
      // Retornar resposta de sucesso
      return res.status(200).json(createResponse(true, responseData, 'Distintivo concedido com sucesso'));
      
    } catch (transactionError) {
      console.error('Transaction error in badge award:', transactionError);
      throw new Error('Erro ao conceder distintivo');
    }
    
  } catch (error) {
    const errorResponse = handleError(error, 'award badge');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Função auxiliar para verificar conteúdo desbloqueado
async function checkUnlockedContent(userId, badgeId) {
  try {
    const unlockedContent = {
      newChallenges: [],
      levelUp: false,
      specialRewards: []
    };
    
    // Verificar se o usuário subiu de nível
    const userPointsResult = await query(`
      SELECT total_points, current_level 
      FROM user_points 
      WHERE user_id = $1
    `, [userId]);
    
    if (userPointsResult.rows.length > 0) {
      const userPoints = userPointsResult.rows[0];
      
      // Verificar se há um nível superior disponível
      const nextLevelResult = await query(`
        SELECT level_number, level_name, points_required 
        FROM levels 
        WHERE points_required <= $1 AND level_number > $2
        ORDER BY level_number DESC 
        LIMIT 1
      `, [userPoints.total_points, userPoints.current_level]);
      
      if (nextLevelResult.rows.length > 0) {
        unlockedContent.levelUp = true;
      }
    }
    
    // Verificar se novos desafios foram desbloqueados
    const newChallengesResult = await query(`
      SELECT id, title, description, points_reward
      FROM challenges 
      WHERE is_active = true 
      AND start_date <= CURRENT_TIMESTAMP 
      AND (end_date IS NULL OR end_date >= CURRENT_TIMESTAMP)
      AND id NOT IN (
        SELECT challenge_id 
        FROM user_challenge_progress 
        WHERE user_id = $1
      )
      LIMIT 3
    `, [userId]);
    
    unlockedContent.newChallenges = newChallengesResult.rows.map(challenge => ({
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      pointsReward: challenge.points_reward
    }));
    
    // Verificar recompensas especiais baseadas no distintivo
    const badgeResult = await query(`
      SELECT name, criteria 
      FROM badges 
      WHERE id = $1
    `, [badgeId]);
    
    if (badgeResult.rows.length > 0) {
      const badge = badgeResult.rows[0];
      const criteria = JSON.parse(badge.criteria);
      
      // Adicionar recompensas especiais baseadas no tipo de distintivo
      if (criteria.orders && criteria.orders >= 10) {
        unlockedContent.specialRewards.push({
          type: 'discount',
          description: 'Desconto especial de 5% no próximo pedido',
          value: 5
        });
      }
      
      if (criteria.referrals && criteria.referrals >= 5) {
        unlockedContent.specialRewards.push({
          type: 'free_delivery',
          description: 'Entrega grátis nos próximos 3 pedidos',
          value: 3
        });
      }
    }
    
    return unlockedContent;
    
  } catch (error) {
    console.error('Error checking unlocked content:', error);
    return {
      newChallenges: [],
      levelUp: false,
      specialRewards: []
    };
  }
}

module.exports.checkUnlockedContent = checkUnlockedContent;

