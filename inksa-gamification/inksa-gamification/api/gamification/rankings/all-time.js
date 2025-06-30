// api/gamification/rankings/all-time.js
// API para ranking geral (all-time)

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
    
    // Obter parâmetros opcionais
    const userId = parseInt(req.query.userId); // Para destacar posição do usuário
    const limit = parseInt(req.query.limit) || 50; // Número de posições no ranking
    const sortBy = req.query.sortBy || 'total_points'; // Critério de ordenação
    
    // Validar limite
    if (limit > 100) {
      return res.status(400).json(createResponse(false, null, 'Limite máximo é 100 posições', 400));
    }
    
    // Validar critério de ordenação
    const validSortOptions = ['total_points', 'current_level', 'badges_count', 'challenges_completed'];
    if (!validSortOptions.includes(sortBy)) {
      return res.status(400).json(createResponse(false, null, 'Critério de ordenação inválido', 400));
    }
    
    // Verificar se userId foi fornecido e se o usuário existe
    if (userId) {
      // Verificar autorização se não for chamada interna
      if (!auth.isInternal && auth.userId !== userId) {
        return res.status(403).json(createResponse(false, null, 'Não autorizado a ver informações deste usuário', 403));
      }
      
      const user = await getUserById(userId);
      if (!user) {
        return res.status(404).json(createResponse(false, null, 'Usuário não encontrado', 404));
      }
    }
    
    // Construir query de ordenação baseada no critério
    let orderByClause;
    switch (sortBy) {
      case 'current_level':
        orderByClause = 'up.current_level DESC, up.total_points DESC';
        break;
      case 'badges_count':
        orderByClause = 'badges_count DESC, up.total_points DESC';
        break;
      case 'challenges_completed':
        orderByClause = 'challenges_completed DESC, up.total_points DESC';
        break;
      default: // total_points
        orderByClause = 'up.total_points DESC, up.current_level DESC';
    }
    
    // Obter ranking geral
    const rankingResult = await query(`
      WITH user_stats AS (
        SELECT 
          u.id as user_id,
          u.name,
          u.email,
          u.created_at as user_since,
          up.total_points,
          up.current_level,
          up.created_at as gamification_since,
          up.updated_at as last_activity,
          COALESCE(badge_counts.badges_count, 0) as badges_count,
          COALESCE(challenge_counts.challenges_completed, 0) as challenges_completed,
          COALESCE(transaction_counts.total_transactions, 0) as total_transactions,
          COALESCE(transaction_counts.first_transaction, up.created_at) as first_transaction,
          COALESCE(transaction_counts.last_transaction, up.created_at) as last_transaction
        FROM users u
        JOIN user_points up ON u.id = up.user_id
        LEFT JOIN (
          SELECT user_id, COUNT(*) as badges_count
          FROM user_badges
          GROUP BY user_id
        ) badge_counts ON u.id = badge_counts.user_id
        LEFT JOIN (
          SELECT user_id, COUNT(*) as challenges_completed
          FROM user_challenge_progress
          WHERE completed = true
          GROUP BY user_id
        ) challenge_counts ON u.id = challenge_counts.user_id
        LEFT JOIN (
          SELECT 
            user_id, 
            COUNT(*) as total_transactions,
            MIN(created_at) as first_transaction,
            MAX(created_at) as last_transaction
          FROM points_history
          GROUP BY user_id
        ) transaction_counts ON u.id = transaction_counts.user_id
        WHERE up.total_points > 0
      ),
      ranked_users AS (
        SELECT 
          *,
          ROW_NUMBER() OVER (ORDER BY ${orderByClause}, user_id ASC) as position
        FROM user_stats
      )
      SELECT * FROM ranked_users
      ORDER BY position
      LIMIT $1
    `, [limit]);
    
    // Obter posição específica do usuário se fornecido
    let userPosition = null;
    if (userId) {
      const userPositionResult = await query(`
        WITH user_stats AS (
          SELECT 
            u.id as user_id,
            u.name,
            u.email,
            u.created_at as user_since,
            up.total_points,
            up.current_level,
            up.created_at as gamification_since,
            up.updated_at as last_activity,
            COALESCE(badge_counts.badges_count, 0) as badges_count,
            COALESCE(challenge_counts.challenges_completed, 0) as challenges_completed,
            COALESCE(transaction_counts.total_transactions, 0) as total_transactions,
            COALESCE(transaction_counts.first_transaction, up.created_at) as first_transaction,
            COALESCE(transaction_counts.last_transaction, up.created_at) as last_transaction
          FROM users u
          JOIN user_points up ON u.id = up.user_id
          LEFT JOIN (
            SELECT user_id, COUNT(*) as badges_count
            FROM user_badges
            GROUP BY user_id
          ) badge_counts ON u.id = badge_counts.user_id
          LEFT JOIN (
            SELECT user_id, COUNT(*) as challenges_completed
            FROM user_challenge_progress
            WHERE completed = true
            GROUP BY user_id
          ) challenge_counts ON u.id = challenge_counts.user_id
          LEFT JOIN (
            SELECT 
              user_id, 
              COUNT(*) as total_transactions,
              MIN(created_at) as first_transaction,
              MAX(created_at) as last_transaction
            FROM points_history
            GROUP BY user_id
          ) transaction_counts ON u.id = transaction_counts.user_id
          WHERE up.total_points > 0
        ),
        ranked_users AS (
          SELECT 
            *,
            ROW_NUMBER() OVER (ORDER BY ${orderByClause}, user_id ASC) as position
          FROM user_stats
        )
        SELECT * FROM ranked_users
        WHERE user_id = $1
      `, [userId]);
      
      if (userPositionResult.rows.length > 0) {
        userPosition = userPositionResult.rows[0];
      }
    }
    
    // Obter estatísticas gerais
    const statsResult = await query(`
      SELECT 
        COUNT(*) as total_users,
        SUM(up.total_points) as total_points_all_users,
        AVG(up.total_points) as avg_points_per_user,
        MAX(up.total_points) as highest_points,
        MIN(up.total_points) as lowest_points,
        AVG(up.current_level) as avg_level,
        MAX(up.current_level) as highest_level
      FROM user_points up
      WHERE up.total_points > 0
    `);
    
    const generalStats = statsResult.rows[0];
    
    // Obter distribuição por níveis
    const levelDistributionResult = await query(`
      SELECT 
        l.level_number,
        l.level_name,
        COUNT(up.user_id) as users_count,
        ROUND(AVG(up.total_points)) as avg_points_in_level
      FROM levels l
      LEFT JOIN user_points up ON up.current_level = l.level_number
      GROUP BY l.level_number, l.level_name
      ORDER BY l.level_number
    `);
    
    const levelDistribution = levelDistributionResult.rows.map(row => ({
      levelNumber: row.level_number,
      levelName: row.level_name,
      usersCount: parseInt(row.users_count),
      percentage: parseInt(generalStats.total_users) > 0 ? 
        Math.round((parseInt(row.users_count) / parseInt(generalStats.total_users)) * 100) : 0,
      averagePoints: parseInt(row.avg_points_in_level) || 0
    }));
    
    // Obter hall da fama (usuários históricos com maiores conquistas)
    const hallOfFameResult = await query(`
      SELECT 
        u.name,
        up.total_points,
        up.current_level,
        badge_counts.badges_count,
        challenge_counts.challenges_completed,
        up.created_at as member_since
      FROM users u
      JOIN user_points up ON u.id = up.user_id
      LEFT JOIN (
        SELECT user_id, COUNT(*) as badges_count
        FROM user_badges
        GROUP BY user_id
      ) badge_counts ON u.id = badge_counts.user_id
      LEFT JOIN (
        SELECT user_id, COUNT(*) as challenges_completed
        FROM user_challenge_progress
        WHERE completed = true
        GROUP BY user_id
      ) challenge_counts ON u.id = challenge_counts.user_id
      WHERE up.total_points >= (
        SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_points)
        FROM user_points
        WHERE total_points > 0
      )
      ORDER BY up.total_points DESC
      LIMIT 10
    `);
    
    const hallOfFame = hallOfFameResult.rows.map(row => ({
      name: row.name,
      totalPoints: parseInt(row.total_points),
      currentLevel: row.current_level,
      badgesCount: parseInt(row.badges_count) || 0,
      challengesCompleted: parseInt(row.challenges_completed) || 0,
      memberSince: row.member_since,
      daysSinceMember: Math.floor((new Date() - new Date(row.member_since)) / (1000 * 60 * 60 * 24))
    }));
    
    // Preparar dados do ranking
    const ranking = rankingResult.rows.map((row, index) => {
      const daysSinceJoined = Math.floor((new Date() - new Date(row.user_since)) / (1000 * 60 * 60 * 24));
      const daysSinceGamification = Math.floor((new Date() - new Date(row.gamification_since)) / (1000 * 60 * 60 * 24));
      const daysSinceLastActivity = Math.floor((new Date() - new Date(row.last_activity)) / (1000 * 60 * 60 * 24));
      
      return {
        position: row.position,
        userId: row.user_id,
        name: row.name,
        email: row.email,
        totalPoints: parseInt(row.total_points),
        currentLevel: row.current_level,
        badgesCount: parseInt(row.badges_count),
        challengesCompleted: parseInt(row.challenges_completed),
        totalTransactions: parseInt(row.total_transactions),
        memberSince: row.user_since,
        gamificationSince: row.gamification_since,
        lastActivity: row.last_activity,
        isCurrentUser: userId === row.user_id,
        statistics: {
          daysSinceJoined: daysSinceJoined,
          daysSinceGamification: daysSinceGamification,
          daysSinceLastActivity: daysSinceLastActivity,
          averagePointsPerDay: daysSinceGamification > 0 ? 
            Math.round(parseInt(row.total_points) / daysSinceGamification) : parseInt(row.total_points),
          averageTransactionsPerDay: daysSinceGamification > 0 ? 
            Math.round(parseInt(row.total_transactions) / daysSinceGamification) : parseInt(row.total_transactions),
          isActive: daysSinceLastActivity <= 7, // Ativo se teve atividade nos últimos 7 dias
          activityLevel: daysSinceLastActivity <= 1 ? 'muito_ativo' :
                        daysSinceLastActivity <= 7 ? 'ativo' :
                        daysSinceLastActivity <= 30 ? 'moderado' : 'inativo'
        },
        badge: (() => {
          if (row.position === 1) return { type: 'legend', name: '👑 Lenda do Inksa' };
          if (row.position === 2) return { type: 'master', name: '🏆 Mestre Supremo' };
          if (row.position === 3) return { type: 'grandmaster', name: '🥇 Grão-Mestre' };
          if (row.position <= 5) return { type: 'elite', name: '⭐ Elite' };
          if (row.position <= 10) return { type: 'veteran', name: '🌟 Veterano' };
          if (row.position <= 25) return { type: 'expert', name: '💎 Especialista' };
          return null;
        })()
      };
    });
    
    // Calcular estatísticas do ranking
    const statistics = {
      general: {
        totalUsers: parseInt(generalStats.total_users),
        totalPointsAllUsers: parseInt(generalStats.total_points_all_users),
        averagePointsPerUser: Math.round(parseFloat(generalStats.avg_points_per_user) || 0),
        highestPoints: parseInt(generalStats.highest_points),
        lowestPoints: parseInt(generalStats.lowest_points),
        averageLevel: Math.round(parseFloat(generalStats.avg_level) || 0),
        highestLevel: parseInt(generalStats.highest_level)
      },
      ranking: {
        usersInRanking: ranking.length,
        userPosition: userPosition ? userPosition.position : null,
        userInTop10: userPosition ? userPosition.position <= 10 : false,
        userInTop25: userPosition ? userPosition.position <= 25 : false,
        userInTop50: userPosition ? userPosition.position <= 50 : false,
        leaderPoints: ranking.length > 0 ? ranking[0].totalPoints : 0,
        pointsGapToLeader: userPosition ? 
          (ranking.length > 0 ? ranking[0].totalPoints - userPosition.total_points : 0) : null
      },
      activity: {
        activeUsers: ranking.filter(u => u.statistics.isActive).length,
        veryActiveUsers: ranking.filter(u => u.statistics.activityLevel === 'muito_ativo').length,
        inactiveUsers: ranking.filter(u => u.statistics.activityLevel === 'inativo').length,
        averageDaysSinceJoined: ranking.length > 0 ? 
          Math.round(ranking.reduce((sum, u) => sum + u.statistics.daysSinceJoined, 0) / ranking.length) : 0
      }
    };
    
    // Preparar resposta
    const responseData = {
      ranking,
      userPosition,
      statistics,
      levelDistribution,
      hallOfFame,
      filters: {
        userId: userId || null,
        limit,
        sortBy
      },
      sortOptions: {
        total_points: 'Total de pontos',
        current_level: 'Nível atual',
        badges_count: 'Número de distintivos',
        challenges_completed: 'Desafios completados'
      }
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Ranking geral obtido com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'get all-time ranking');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

