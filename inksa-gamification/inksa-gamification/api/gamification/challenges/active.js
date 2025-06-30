// api/gamification/challenges/active.js
// API para obter desafios ativos

const { query } = require('../utils/database');
const { 
  authenticateUser, 
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
    if (req.method !== 'GET') {
      return res.status(405).json(createResponse(false, null, 'Método não permitido', 405));
    }
    
    // Autenticar usuário ou verificar API key
    const auth = authenticateUser(req);
    
    // Obter parâmetros opcionais
    const userId = parseInt(req.query.userId); // Para mostrar progresso do usuário
    const challengeType = req.query.type; // Filtrar por tipo (daily, weekly, monthly, special)
    const includeCompleted = req.query.includeCompleted === 'true'; // Incluir desafios já completados
    
    // Construir query base para desafios ativos
    let challengesQuery = `
      SELECT 
        id,
        title,
        description,
        challenge_type,
        criteria,
        points_reward,
        badge_reward,
        start_date,
        end_date,
        is_active
      FROM challenges 
      WHERE is_active = true 
      AND start_date <= CURRENT_TIMESTAMP 
      AND (end_date IS NULL OR end_date >= CURRENT_TIMESTAMP)
    `;
    
    const queryParams = [];
    
    // Adicionar filtro por tipo se fornecido
    if (challengeType) {
      challengesQuery += ` AND challenge_type = $${queryParams.length + 1}`;
      queryParams.push(challengeType);
    }
    
    challengesQuery += ` ORDER BY 
      CASE challenge_type 
        WHEN 'daily' THEN 1 
        WHEN 'weekly' THEN 2 
        WHEN 'monthly' THEN 3 
        WHEN 'special' THEN 4 
      END,
      end_date ASC NULLS LAST,
      points_reward DESC
    `;
    
    const challengesResult = await query(challengesQuery, queryParams);
    
    // Se userId foi fornecido, obter progresso do usuário nos desafios
    let userProgress = {};
    if (userId) {
      // Verificar autorização se não for chamada interna
      if (!auth.isInternal && auth.userId !== userId) {
        return res.status(403).json(createResponse(false, null, 'Não autorizado a ver progresso deste usuário', 403));
      }
      
      const progressResult = await query(`
        SELECT 
          challenge_id,
          progress,
          target,
          completed,
          completed_at,
          created_at,
          updated_at
        FROM user_challenge_progress 
        WHERE user_id = $1
      `, [userId]);
      
      userProgress = progressResult.rows.reduce((progress, row) => {
        progress[row.challenge_id] = {
          progress: row.progress,
          target: row.target,
          completed: row.completed,
          completedAt: row.completed_at,
          startedAt: row.created_at,
          lastUpdated: row.updated_at,
          progressPercentage: Math.round((row.progress / row.target) * 100)
        };
        return progress;
      }, {});
    }
    
    // Obter informações dos distintivos recompensa
    const badgeIds = challengesResult.rows
      .filter(challenge => challenge.badge_reward)
      .map(challenge => challenge.badge_reward);
    
    let badgeRewards = {};
    if (badgeIds.length > 0) {
      const badgesResult = await query(`
        SELECT id, name, description, icon_url
        FROM badges 
        WHERE id = ANY($1)
      `, [badgeIds]);
      
      badgeRewards = badgesResult.rows.reduce((badges, badge) => {
        badges[badge.id] = {
          id: badge.id,
          name: badge.name,
          description: badge.description,
          iconUrl: badge.icon_url
        };
        return badges;
      }, {});
    }
    
    // Obter estatísticas dos desafios
    const statsResult = await query(`
      SELECT 
        challenge_id,
        COUNT(*) as participants,
        COUNT(CASE WHEN completed = true THEN 1 END) as completions,
        AVG(progress::float / target::float) as avg_progress
      FROM user_challenge_progress
      WHERE challenge_id = ANY($1)
      GROUP BY challenge_id
    `, [challengesResult.rows.map(c => c.id)]);
    
    const challengeStats = statsResult.rows.reduce((stats, row) => {
      stats[row.challenge_id] = {
        participants: parseInt(row.participants),
        completions: parseInt(row.completions),
        completionRate: row.participants > 0 ? 
          Math.round((parseInt(row.completions) / parseInt(row.participants)) * 100) : 0,
        averageProgress: Math.round(parseFloat(row.avg_progress) * 100) || 0
      };
      return stats;
    }, {});
    
    // Preparar dados dos desafios
    const challenges = challengesResult.rows.map(challenge => {
      const criteria = JSON.parse(challenge.criteria);
      const userChallengeProgress = userProgress[challenge.id];
      const stats = challengeStats[challenge.id] || { 
        participants: 0, 
        completions: 0, 
        completionRate: 0, 
        averageProgress: 0 
      };
      
      // Calcular tempo restante
      const now = new Date();
      const endDate = challenge.end_date ? new Date(challenge.end_date) : null;
      const timeRemaining = endDate ? Math.max(0, endDate - now) : null;
      
      // Determinar dificuldade baseada nos critérios
      let difficulty = 'facil';
      if (criteria.orders && criteria.orders >= 10) difficulty = 'dificil';
      else if (criteria.orders && criteria.orders >= 5) difficulty = 'medio';
      else if (criteria.different_restaurants && criteria.different_restaurants >= 5) difficulty = 'dificil';
      else if (criteria.different_restaurants && criteria.different_restaurants >= 3) difficulty = 'medio';
      
      const challengeData = {
        id: challenge.id,
        title: challenge.title,
        description: challenge.description,
        type: challenge.challenge_type,
        criteria: criteria,
        pointsReward: challenge.points_reward,
        badgeReward: challenge.badge_reward ? badgeRewards[challenge.badge_reward] : null,
        startDate: challenge.start_date,
        endDate: challenge.end_date,
        timeRemaining: timeRemaining ? {
          milliseconds: timeRemaining,
          days: Math.floor(timeRemaining / (1000 * 60 * 60 * 24)),
          hours: Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))
        } : null,
        difficulty: difficulty,
        statistics: stats,
        userProgress: userChallengeProgress || null,
        isParticipating: !!userChallengeProgress,
        isCompleted: userChallengeProgress ? userChallengeProgress.completed : false,
        canParticipate: !userChallengeProgress || !userChallengeProgress.completed
      };
      
      return challengeData;
    });
    
    // Filtrar desafios completados se solicitado
    const filteredChallenges = includeCompleted ? 
      challenges : 
      challenges.filter(challenge => !challenge.isCompleted);
    
    // Agrupar por tipo
    const challengesByType = filteredChallenges.reduce((types, challenge) => {
      if (!types[challenge.type]) types[challenge.type] = [];
      types[challenge.type].push(challenge);
      return types;
    }, {});
    
    // Calcular estatísticas gerais
    const statistics = {
      totalActive: filteredChallenges.length,
      totalParticipating: userId ? filteredChallenges.filter(c => c.isParticipating).length : 0,
      totalCompleted: userId ? filteredChallenges.filter(c => c.isCompleted).length : 0,
      totalPointsAvailable: filteredChallenges.reduce((sum, c) => sum + c.pointsReward, 0),
      typeCounts: Object.keys(challengesByType).reduce((counts, type) => {
        counts[type] = challengesByType[type].length;
        return counts;
      }, {}),
      expiringToday: filteredChallenges.filter(c => {
        if (!c.endDate) return false;
        const endDate = new Date(c.endDate);
        const today = new Date();
        return endDate.toDateString() === today.toDateString();
      }).length,
      newChallenges: filteredChallenges.filter(c => {
        const startDate = new Date(c.startDate);
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        return startDate >= threeDaysAgo;
      }).length
    };
    
    // Preparar resposta
    const responseData = {
      challenges: filteredChallenges,
      challengesByType,
      statistics,
      filters: {
        userId: userId || null,
        type: challengeType || null,
        includeCompleted
      },
      challengeTypes: {
        daily: 'Desafios diários',
        weekly: 'Desafios semanais',
        monthly: 'Desafios mensais',
        special: 'Desafios especiais'
      }
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Desafios ativos obtidos com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'get active challenges');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

