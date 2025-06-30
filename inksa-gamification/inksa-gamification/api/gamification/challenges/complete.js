// api/gamification/challenges/complete.js
// API para completar desafios

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
    const requiredFields = ['userId', 'challengeId'];
    validateRequiredParams(body, requiredFields);
    
    // Validar tipos de dados
    validateDataTypes(body, {
      userId: 'integer',
      challengeId: 'integer',
      autoComplete: 'boolean'
    });
    
    const { userId, challengeId, autoComplete = false } = body;
    
    // Verificar se o usuário existe
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createResponse(false, null, 'Usuário não encontrado', 404));
    }
    
    // Verificar autorização (usuário só pode completar seus próprios desafios, exceto chamadas internas)
    if (!auth.isInternal && auth.userId !== userId) {
      return res.status(403).json(createResponse(false, null, 'Não autorizado a completar desafios para este usuário', 403));
    }
    
    // Verificar se o desafio existe e está ativo
    const challengeResult = await query(`
      SELECT 
        id, title, description, challenge_type, criteria, points_reward, 
        badge_reward, start_date, end_date, is_active
      FROM challenges 
      WHERE id = $1 AND is_active = true
    `, [challengeId]);
    
    if (challengeResult.rows.length === 0) {
      return res.status(404).json(createResponse(false, null, 'Desafio não encontrado ou inativo', 404));
    }
    
    const challenge = challengeResult.rows[0];
    
    // Verificar se o desafio ainda está no período válido
    const now = new Date();
    const startDate = new Date(challenge.start_date);
    const endDate = challenge.end_date ? new Date(challenge.end_date) : null;
    
    if (now < startDate) {
      return res.status(400).json(createResponse(false, null, 'Desafio ainda não iniciou', 400));
    }
    
    if (endDate && now > endDate) {
      return res.status(400).json(createResponse(false, null, 'Desafio já expirou', 400));
    }
    
    // Verificar progresso atual do usuário no desafio
    const progressResult = await query(`
      SELECT id, progress, target, completed, completed_at, created_at, updated_at
      FROM user_challenge_progress 
      WHERE user_id = $1 AND challenge_id = $2
    `, [userId, challengeId]);
    
    if (progressResult.rows.length === 0) {
      return res.status(404).json(createResponse(false, null, 'Usuário não está participando deste desafio', 404));
    }
    
    const userProgress = progressResult.rows[0];
    
    // Verificar se o desafio já foi completado
    if (userProgress.completed) {
      return res.status(400).json(createResponse(false, null, 'Desafio já foi completado', 400));
    }
    
    // Verificar se o usuário atingiu o objetivo (exceto para autoComplete)
    if (!autoComplete && userProgress.progress < userProgress.target) {
      return res.status(400).json(createResponse(false, null, 
        `Objetivo não atingido. Progresso atual: ${userProgress.progress}/${userProgress.target}`, 400));
    }
    
    try {
      // Iniciar transação para completar o desafio
      const queries = [
        // Marcar desafio como completado
        {
          text: `UPDATE user_challenge_progress 
                 SET completed = true, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE user_id = $1 AND challenge_id = $2`,
          params: [userId, challengeId]
        }
      ];
      
      await transaction(queries);
      
      // Adicionar pontos da recompensa
      let pointsResult = null;
      if (challenge.points_reward > 0) {
        pointsResult = await addPointsToUser(
          userId,
          challenge.points_reward,
          'challenge',
          `Desafio completado: ${challenge.title}`,
          null
        );
      }
      
      // Conceder distintivo se houver recompensa de distintivo
      let badgeResult = null;
      if (challenge.badge_reward) {
        try {
          // Verificar se o usuário já possui este distintivo
          const existingBadgeResult = await query(`
            SELECT id FROM user_badges 
            WHERE user_id = $1 AND badge_id = $2
          `, [userId, challenge.badge_reward]);
          
          if (existingBadgeResult.rows.length === 0) {
            // Conceder o distintivo
            await query(`
              INSERT INTO user_badges (user_id, badge_id, earned_at) 
              VALUES ($1, $2, CURRENT_TIMESTAMP)
            `, [userId, challenge.badge_reward]);
            
            // Obter informações do distintivo
            const badgeInfoResult = await query(`
              SELECT id, name, description, icon_url, points_reward
              FROM badges 
              WHERE id = $1
            `, [challenge.badge_reward]);
            
            if (badgeInfoResult.rows.length > 0) {
              const badge = badgeInfoResult.rows[0];
              badgeResult = {
                id: badge.id,
                name: badge.name,
                description: badge.description,
                iconUrl: badge.icon_url,
                pointsReward: badge.points_reward
              };
              
              // Adicionar pontos do distintivo se houver
              if (badge.points_reward > 0) {
                await addPointsToUser(
                  userId,
                  badge.points_reward,
                  'badge',
                  `Distintivo conquistado: ${badge.name}`,
                  null
                );
              }
            }
          }
        } catch (badgeError) {
          console.error('Error awarding badge:', badgeError);
          // Não falhar a conclusão do desafio por erro no distintivo
        }
      }
      
      // Obter progresso atualizado
      const updatedProgressResult = await query(`
        SELECT 
          ucp.id, ucp.progress, ucp.target, ucp.completed, ucp.completed_at, 
          ucp.created_at, ucp.updated_at,
          c.title, c.description, c.challenge_type
        FROM user_challenge_progress ucp
        JOIN challenges c ON ucp.challenge_id = c.id
        WHERE ucp.user_id = $1 AND ucp.challenge_id = $2
      `, [userId, challengeId]);
      
      const updatedProgress = updatedProgressResult.rows[0];
      
      // Calcular tempo gasto no desafio
      const startedAt = new Date(updatedProgress.created_at);
      const completedAt = new Date(updatedProgress.completed_at);
      const timeSpent = completedAt - startedAt;
      
      // Verificar se há novos desafios desbloqueados
      const newChallengesResult = await query(`
        SELECT id, title, description, challenge_type, points_reward
        FROM challenges 
        WHERE is_active = true 
        AND start_date <= CURRENT_TIMESTAMP 
        AND (end_date IS NULL OR end_date >= CURRENT_TIMESTAMP)
        AND id NOT IN (
          SELECT challenge_id 
          FROM user_challenge_progress 
          WHERE user_id = $1
        )
        AND challenge_type = $2
        LIMIT 3
      `, [userId, challenge.challenge_type]);
      
      const newChallenges = newChallengesResult.rows.map(c => ({
        id: c.id,
        title: c.title,
        description: c.description,
        type: c.challenge_type,
        pointsReward: c.points_reward
      }));
      
      // Preparar resposta
      const responseData = {
        userId,
        challengeId,
        challenge: {
          title: challenge.title,
          description: challenge.description,
          type: challenge.challenge_type,
          pointsReward: challenge.points_reward
        },
        completion: {
          completedAt: updatedProgress.completed_at,
          timeSpent: {
            milliseconds: timeSpent,
            days: Math.floor(timeSpent / (1000 * 60 * 60 * 24)),
            hours: Math.floor((timeSpent % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
            minutes: Math.floor((timeSpent % (1000 * 60 * 60)) / (1000 * 60))
          },
          finalProgress: {
            current: updatedProgress.progress,
            target: updatedProgress.target,
            percentage: Math.round((updatedProgress.progress / updatedProgress.target) * 100)
          }
        },
        rewards: {
          pointsEarned: challenge.points_reward + (badgeResult ? badgeResult.pointsReward : 0),
          badgeEarned: badgeResult,
          newTotalPoints: pointsResult ? pointsResult.newTotal : null,
          currentLevel: pointsResult ? pointsResult.currentLevel : null,
          pointsToNextLevel: pointsResult ? pointsResult.pointsToNextLevel : null
        },
        unlockedContent: {
          newChallenges: newChallenges,
          hasNewChallenges: newChallenges.length > 0
        }
      };
      
      // Retornar resposta de sucesso
      return res.status(200).json(createResponse(true, responseData, 'Desafio completado com sucesso'));
      
    } catch (transactionError) {
      console.error('Transaction error in challenge completion:', transactionError);
      throw new Error('Erro ao completar desafio');
    }
    
  } catch (error) {
    const errorResponse = handleError(error, 'complete challenge');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

