// api/gamification/challenges/progress.js
// API para obter progresso do usuário nos desafios

const { query, getUserById } = require('../utils/database');
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
    
    // Obter userId dos parâmetros da query
    const userId = parseInt(req.query.userId);
    const challengeId = parseInt(req.query.challengeId); // Opcional: progresso de um desafio específico
    const status = req.query.status; // Filtrar por status: 'active', 'completed', 'all'
    
    // Validar parâmetros obrigatórios
    if (!userId) {
      return res.status(400).json(createResponse(false, null, 'userId é obrigatório', 400));
    }
    
    // Verificar se o usuário existe
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createResponse(false, null, 'Usuário não encontrado', 404));
    }
    
    // Verificar autorização (usuário só pode ver seu próprio progresso, exceto chamadas internas)
    if (!auth.isInternal && auth.userId !== userId) {
      return res.status(403).json(createResponse(false, null, 'Não autorizado a ver progresso deste usuário', 403));
    }
    
    // Construir query base
    let progressQuery = `
      SELECT 
        ucp.id,
        ucp.challenge_id,
        ucp.progress,
        ucp.target,
        ucp.completed,
        ucp.completed_at,
        ucp.created_at,
        ucp.updated_at,
        c.title,
        c.description,
        c.challenge_type,
        c.criteria,
        c.points_reward,
        c.badge_reward,
        c.start_date,
        c.end_date,
        c.is_active
      FROM user_challenge_progress ucp
      JOIN challenges c ON ucp.challenge_id = c.id
      WHERE ucp.user_id = $1
    `;
    
    const queryParams = [userId];
    let paramIndex = 2;
    
    // Filtrar por desafio específico se fornecido
    if (challengeId) {
      progressQuery += ` AND ucp.challenge_id = $${paramIndex}`;
      queryParams.push(challengeId);
      paramIndex++;
    }
    
    // Filtrar por status se fornecido
    if (status === 'active') {
      progressQuery += ` AND ucp.completed = false AND c.is_active = true AND c.start_date <= CURRENT_TIMESTAMP AND (c.end_date IS NULL OR c.end_date >= CURRENT_TIMESTAMP)`;
    } else if (status === 'completed') {
      progressQuery += ` AND ucp.completed = true`;
    }
    
    progressQuery += ` ORDER BY 
      ucp.completed ASC,
      c.end_date ASC NULLS LAST,
      ucp.updated_at DESC
    `;
    
    const progressResult = await query(progressQuery, queryParams);
    
    // Obter informações dos distintivos recompensa
    const badgeIds = progressResult.rows
      .filter(row => row.badge_reward)
      .map(row => row.badge_reward);
    
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
    
    // Obter histórico de atualizações de progresso (últimas 10 por desafio)
    const historyResult = await query(`
      SELECT 
        challenge_id,
        points_earned,
        points_type,
        description,
        created_at
      FROM points_history 
      WHERE user_id = $1 
      AND points_type = 'challenge'
      AND created_at >= NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT 50
    `, [userId]);
    
    const progressHistory = historyResult.rows.reduce((history, row) => {
      if (!history[row.challenge_id]) history[row.challenge_id] = [];
      history[row.challenge_id].push({
        pointsEarned: row.points_earned,
        description: row.description,
        earnedAt: row.created_at
      });
      return history;
    }, {});
    
    // Preparar dados do progresso
    const challengeProgress = progressResult.rows.map(row => {
      const criteria = JSON.parse(row.criteria);
      const progressPercentage = Math.round((row.progress / row.target) * 100);
      
      // Calcular tempo restante
      const now = new Date();
      const endDate = row.end_date ? new Date(row.end_date) : null;
      const timeRemaining = endDate ? Math.max(0, endDate - now) : null;
      
      // Determinar status do desafio
      let challengeStatus = 'active';
      if (row.completed) {
        challengeStatus = 'completed';
      } else if (endDate && endDate < now) {
        challengeStatus = 'expired';
      } else if (!row.is_active) {
        challengeStatus = 'inactive';
      }
      
      // Calcular tempo gasto no desafio
      const startedAt = new Date(row.created_at);
      const completedAt = row.completed_at ? new Date(row.completed_at) : now;
      const timeSpent = completedAt - startedAt;
      
      return {
        id: row.id,
        challengeId: row.challenge_id,
        challenge: {
          title: row.title,
          description: row.description,
          type: row.challenge_type,
          criteria: criteria,
          pointsReward: row.points_reward,
          badgeReward: row.badge_reward ? badgeRewards[row.badge_reward] : null,
          startDate: row.start_date,
          endDate: row.end_date
        },
        progress: {
          current: row.progress,
          target: row.target,
          percentage: progressPercentage,
          remaining: row.target - row.progress,
          isCompleted: row.completed,
          completedAt: row.completed_at,
          startedAt: row.created_at,
          lastUpdated: row.updated_at
        },
        timeRemaining: timeRemaining ? {
          milliseconds: timeRemaining,
          days: Math.floor(timeRemaining / (1000 * 60 * 60 * 24)),
          hours: Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))
        } : null,
        timeSpent: {
          milliseconds: timeSpent,
          days: Math.floor(timeSpent / (1000 * 60 * 60 * 24)),
          hours: Math.floor((timeSpent % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
          minutes: Math.floor((timeSpent % (1000 * 60 * 60)) / (1000 * 60))
        },
        status: challengeStatus,
        history: progressHistory[row.challenge_id] || [],
        canComplete: row.progress >= row.target && !row.completed && challengeStatus === 'active'
      };
    });
    
    // Agrupar por status
    const progressByStatus = challengeProgress.reduce((statuses, progress) => {
      if (!statuses[progress.status]) statuses[progress.status] = [];
      statuses[progress.status].push(progress);
      return statuses;
    }, {});
    
    // Agrupar por tipo de desafio
    const progressByType = challengeProgress.reduce((types, progress) => {
      const type = progress.challenge.type;
      if (!types[type]) types[type] = [];
      types[type].push(progress);
      return types;
    }, {});
    
    // Calcular estatísticas
    const statistics = {
      totalChallenges: challengeProgress.length,
      activeChallenges: challengeProgress.filter(p => p.status === 'active').length,
      completedChallenges: challengeProgress.filter(p => p.status === 'completed').length,
      expiredChallenges: challengeProgress.filter(p => p.status === 'expired').length,
      totalPointsEarned: challengeProgress
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + p.challenge.pointsReward, 0),
      averageCompletionTime: (() => {
        const completed = challengeProgress.filter(p => p.status === 'completed');
        if (completed.length === 0) return 0;
        const totalTime = completed.reduce((sum, p) => sum + p.timeSpent.milliseconds, 0);
        return Math.round(totalTime / completed.length / (1000 * 60 * 60 * 24)); // em dias
      })(),
      completionRate: challengeProgress.length > 0 ? 
        Math.round((challengeProgress.filter(p => p.status === 'completed').length / challengeProgress.length) * 100) : 0,
      nearCompletion: challengeProgress.filter(p => 
        p.status === 'active' && p.progress.percentage >= 80
      ).length,
      canCompleteNow: challengeProgress.filter(p => p.canComplete).length
    };
    
    // Preparar resposta
    const responseData = {
      userId,
      challengeProgress,
      progressByStatus,
      progressByType,
      statistics,
      filters: {
        challengeId: challengeId || null,
        status: status || 'all'
      }
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Progresso dos desafios obtido com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'get challenge progress');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

