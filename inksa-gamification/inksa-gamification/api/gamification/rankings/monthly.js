// api/gamification/rankings/monthly.js
// API para ranking mensal

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
    const month = req.query.month; // Mês específico (formato: YYYY-MM)
    
    // Validar limite
    if (limit > 100) {
      return res.status(400).json(createResponse(false, null, 'Limite máximo é 100 posições', 400));
    }
    
    // Calcular período do mês
    let monthStart, monthEnd;
    if (month) {
      const [year, monthNum] = month.split('-').map(Number);
      monthStart = new Date(year, monthNum - 1, 1);
      monthEnd = new Date(year, monthNum, 0, 23, 59, 59, 999);
    } else {
      // Mês atual
      const now = new Date();
      monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
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
    
    // Obter ranking mensal baseado em pontos ganhos no mês
    const rankingResult = await query(`
      WITH monthly_points AS (
        SELECT 
          ph.user_id,
          u.name,
          u.email,
          SUM(ph.points_earned) as points_this_month,
          COUNT(ph.id) as transactions_this_month,
          COUNT(DISTINCT DATE(ph.created_at)) as active_days,
          up.total_points,
          up.current_level,
          MIN(ph.created_at) as first_activity,
          MAX(ph.created_at) as last_activity
        FROM points_history ph
        JOIN users u ON ph.user_id = u.id
        JOIN user_points up ON ph.user_id = up.user_id
        WHERE ph.created_at >= $1 AND ph.created_at <= $2
        GROUP BY ph.user_id, u.name, u.email, up.total_points, up.current_level
        HAVING SUM(ph.points_earned) > 0
      ),
      ranked_users AS (
        SELECT 
          *,
          ROW_NUMBER() OVER (ORDER BY points_this_month DESC, active_days DESC, total_points DESC, user_id ASC) as position
        FROM monthly_points
      )
      SELECT * FROM ranked_users
      ORDER BY position
      LIMIT $3
    `, [monthStart, monthEnd, limit]);
    
    // Obter posição específica do usuário se fornecido
    let userPosition = null;
    if (userId) {
      const userPositionResult = await query(`
        WITH monthly_points AS (
          SELECT 
            ph.user_id,
            SUM(ph.points_earned) as points_this_month,
            COUNT(ph.id) as transactions_this_month,
            COUNT(DISTINCT DATE(ph.created_at)) as active_days,
            MIN(ph.created_at) as first_activity,
            MAX(ph.created_at) as last_activity
          FROM points_history ph
          WHERE ph.created_at >= $1 AND ph.created_at <= $2
          GROUP BY ph.user_id
          HAVING SUM(ph.points_earned) > 0
        ),
        ranked_users AS (
          SELECT 
            user_id,
            points_this_month,
            transactions_this_month,
            active_days,
            first_activity,
            last_activity,
            ROW_NUMBER() OVER (ORDER BY points_this_month DESC, active_days DESC, user_id ASC) as position
          FROM monthly_points
        )
        SELECT 
          ru.*,
          u.name,
          u.email,
          up.total_points,
          up.current_level
        FROM ranked_users ru
        JOIN users u ON ru.user_id = u.id
        JOIN user_points up ON ru.user_id = up.user_id
        WHERE ru.user_id = $3
      `, [monthStart, monthEnd, userId]);
      
      if (userPositionResult.rows.length > 0) {
        userPosition = userPositionResult.rows[0];
      }
    }
    
    // Obter estatísticas do mês
    const statsResult = await query(`
      SELECT 
        COUNT(DISTINCT ph.user_id) as active_users,
        SUM(ph.points_earned) as total_points_earned,
        AVG(ph.points_earned) as avg_points_per_transaction,
        COUNT(ph.id) as total_transactions,
        COUNT(DISTINCT DATE(ph.created_at)) as active_days_total,
        MAX(ph.points_earned) as highest_single_transaction
      FROM points_history ph
      WHERE ph.created_at >= $1 AND ph.created_at <= $2
    `, [monthStart, monthEnd]);
    
    const monthStats = statsResult.rows[0];
    
    // Obter evolução diária do mês
    const dailyEvolutionResult = await query(`
      SELECT 
        DATE(ph.created_at) as day,
        SUM(ph.points_earned) as points_day,
        COUNT(DISTINCT ph.user_id) as active_users_day,
        COUNT(ph.id) as transactions_day
      FROM points_history ph
      WHERE ph.created_at >= $1 AND ph.created_at <= $2
      GROUP BY DATE(ph.created_at)
      ORDER BY day
    `, [monthStart, monthEnd]);
    
    const dailyEvolution = dailyEvolutionResult.rows.map(row => ({
      date: row.day,
      points: parseInt(row.points_day),
      activeUsers: parseInt(row.active_users_day),
      transactions: parseInt(row.transactions_day)
    }));
    
    // Obter top performers por categoria no mês
    const categoryStatsResult = await query(`
      SELECT 
        ph.points_type,
        ph.user_id,
        u.name,
        SUM(ph.points_earned) as points_in_category,
        COUNT(ph.id) as transactions_in_category,
        AVG(ph.points_earned) as avg_points_in_category
      FROM points_history ph
      JOIN users u ON ph.user_id = u.id
      WHERE ph.created_at >= $1 AND ph.created_at <= $2
      GROUP BY ph.points_type, ph.user_id, u.name
      ORDER BY ph.points_type, points_in_category DESC
    `, [monthStart, monthEnd]);
    
    // Agrupar por categoria e pegar o top 5 de cada
    const topByCategory = categoryStatsResult.rows.reduce((categories, row) => {
      if (!categories[row.points_type]) categories[row.points_type] = [];
      if (categories[row.points_type].length < 5) {
        categories[row.points_type].push({
          userId: row.user_id,
          name: row.name,
          points: parseInt(row.points_in_category),
          transactions: parseInt(row.transactions_in_category),
          averagePoints: Math.round(parseFloat(row.avg_points_in_category))
        });
      }
      return categories;
    }, {});
    
    // Obter distintivos mais conquistados no mês
    const badgeStatsResult = await query(`
      SELECT 
        b.id,
        b.name,
        b.description,
        b.icon_url,
        COUNT(ub.id) as times_earned
      FROM user_badges ub
      JOIN badges b ON ub.badge_id = b.id
      WHERE ub.earned_at >= $1 AND ub.earned_at <= $2
      GROUP BY b.id, b.name, b.description, b.icon_url
      ORDER BY times_earned DESC
      LIMIT 5
    `, [monthStart, monthEnd]);
    
    const topBadges = badgeStatsResult.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      iconUrl: row.icon_url,
      timesEarned: parseInt(row.times_earned)
    }));
    
    // Preparar dados do ranking
    const ranking = rankingResult.rows.map((row, index) => ({
      position: row.position,
      userId: row.user_id,
      name: row.name,
      email: row.email,
      pointsThisMonth: parseInt(row.points_this_month),
      transactionsThisMonth: parseInt(row.transactions_this_month),
      activeDays: parseInt(row.active_days),
      totalPoints: parseInt(row.total_points),
      currentLevel: row.current_level,
      firstActivity: row.first_activity,
      lastActivity: row.last_activity,
      isCurrentUser: userId === row.user_id,
      consistency: Math.round((parseInt(row.active_days) / getDaysInMonth(monthStart)) * 100),
      averagePointsPerDay: Math.round(parseInt(row.points_this_month) / parseInt(row.active_days)),
      badge: (() => {
        if (row.position === 1) return { type: 'gold', name: '👑 Campeão do Mês' };
        if (row.position === 2) return { type: 'silver', name: '🥈 Vice-Campeão' };
        if (row.position === 3) return { type: 'bronze', name: '🥉 Terceiro Lugar' };
        if (row.position <= 5) return { type: 'top5', name: '⭐ Top 5' };
        if (row.position <= 10) return { type: 'top10', name: '🌟 Top 10' };
        return null;
      })()
    }));
    
    // Calcular estatísticas do período
    const daysInMonth = getDaysInMonth(monthStart);
    const statistics = {
      period: {
        start: monthStart,
        end: monthEnd,
        month: monthStart.getMonth() + 1,
        year: monthStart.getFullYear(),
        monthName: monthStart.toLocaleDateString('pt-BR', { month: 'long' }),
        daysInMonth: daysInMonth,
        isCurrentMonth: isCurrentMonth(monthStart)
      },
      participants: {
        total: parseInt(monthStats.active_users),
        inRanking: ranking.length,
        userPosition: userPosition ? userPosition.position : null,
        userInTop5: userPosition ? userPosition.position <= 5 : false,
        userInTop10: userPosition ? userPosition.position <= 10 : false,
        userInTop50: userPosition ? userPosition.position <= 50 : false
      },
      points: {
        totalEarned: parseInt(monthStats.total_points_earned),
        averagePerTransaction: Math.round(parseFloat(monthStats.avg_points_per_transaction) || 0),
        averagePerUser: ranking.length > 0 ? 
          Math.round(parseInt(monthStats.total_points_earned) / parseInt(monthStats.active_users)) : 0,
        averagePerDay: Math.round(parseInt(monthStats.total_points_earned) / daysInMonth),
        highestSingleTransaction: parseInt(monthStats.highest_single_transaction) || 0,
        leaderPoints: ranking.length > 0 ? ranking[0].pointsThisMonth : 0
      },
      activity: {
        totalTransactions: parseInt(monthStats.total_transactions),
        activeDaysTotal: parseInt(monthStats.active_days_total),
        averageTransactionsPerUser: parseInt(monthStats.active_users) > 0 ? 
          Math.round(parseInt(monthStats.total_transactions) / parseInt(monthStats.active_users)) : 0,
        averageTransactionsPerDay: Math.round(parseInt(monthStats.total_transactions) / daysInMonth),
        peakDay: dailyEvolution.length > 0 ? 
          dailyEvolution.reduce((max, day) => day.points > max.points ? day : max) : null
      }
    };
    
    // Preparar resposta
    const responseData = {
      ranking,
      userPosition,
      statistics,
      dailyEvolution,
      topByCategory,
      topBadges,
      filters: {
        userId: userId || null,
        limit,
        month: month || null
      }
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Ranking mensal obtido com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'get monthly ranking');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Função auxiliar para obter número de dias no mês
function getDaysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// Função auxiliar para verificar se é o mês atual
function isCurrentMonth(monthStart) {
  const now = new Date();
  return now.getFullYear() === monthStart.getFullYear() && 
         now.getMonth() === monthStart.getMonth();
}

