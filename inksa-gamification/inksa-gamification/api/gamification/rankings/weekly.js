// api/gamification/rankings/weekly.js
// API para ranking semanal

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
    const week = req.query.week; // Semana específica (formato: YYYY-MM-DD)
    
    // Validar limite
    if (limit > 100) {
      return res.status(400).json(createResponse(false, null, 'Limite máximo é 100 posições', 400));
    }
    
    // Calcular período da semana
    let weekStart, weekEnd;
    if (week) {
      weekStart = new Date(week);
      weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
    } else {
      // Semana atual (segunda a domingo)
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0 = domingo, 1 = segunda, etc.
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Ajustar para segunda-feira
      
      weekStart = new Date(now);
      weekStart.setDate(now.getDate() - daysToMonday);
      weekStart.setHours(0, 0, 0, 0);
      
      weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
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
    
    // Obter ranking semanal baseado em pontos ganhos na semana
    const rankingResult = await query(`
      WITH weekly_points AS (
        SELECT 
          ph.user_id,
          u.name,
          u.email,
          SUM(ph.points_earned) as points_this_week,
          COUNT(ph.id) as transactions_this_week,
          up.total_points,
          up.current_level
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
          ROW_NUMBER() OVER (ORDER BY points_this_week DESC, total_points DESC, user_id ASC) as position
        FROM weekly_points
      )
      SELECT * FROM ranked_users
      ORDER BY position
      LIMIT $3
    `, [weekStart, weekEnd, limit]);
    
    // Obter posição específica do usuário se fornecido
    let userPosition = null;
    if (userId) {
      const userPositionResult = await query(`
        WITH weekly_points AS (
          SELECT 
            ph.user_id,
            SUM(ph.points_earned) as points_this_week,
            COUNT(ph.id) as transactions_this_week
          FROM points_history ph
          WHERE ph.created_at >= $1 AND ph.created_at <= $2
          GROUP BY ph.user_id
          HAVING SUM(ph.points_earned) > 0
        ),
        ranked_users AS (
          SELECT 
            user_id,
            points_this_week,
            transactions_this_week,
            ROW_NUMBER() OVER (ORDER BY points_this_week DESC, user_id ASC) as position
          FROM weekly_points
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
      `, [weekStart, weekEnd, userId]);
      
      if (userPositionResult.rows.length > 0) {
        userPosition = userPositionResult.rows[0];
      }
    }
    
    // Obter estatísticas da semana
    const statsResult = await query(`
      SELECT 
        COUNT(DISTINCT ph.user_id) as active_users,
        SUM(ph.points_earned) as total_points_earned,
        AVG(ph.points_earned) as avg_points_per_transaction,
        COUNT(ph.id) as total_transactions,
        MAX(ph.points_earned) as highest_single_transaction
      FROM points_history ph
      WHERE ph.created_at >= $1 AND ph.created_at <= $2
    `, [weekStart, weekEnd]);
    
    const weekStats = statsResult.rows[0];
    
    // Obter top performers por categoria
    const categoryStatsResult = await query(`
      SELECT 
        ph.points_type,
        ph.user_id,
        u.name,
        SUM(ph.points_earned) as points_in_category,
        COUNT(ph.id) as transactions_in_category
      FROM points_history ph
      JOIN users u ON ph.user_id = u.id
      WHERE ph.created_at >= $1 AND ph.created_at <= $2
      GROUP BY ph.points_type, ph.user_id, u.name
      ORDER BY ph.points_type, points_in_category DESC
    `, [weekStart, weekEnd]);
    
    // Agrupar por categoria e pegar o top 3 de cada
    const topByCategory = categoryStatsResult.rows.reduce((categories, row) => {
      if (!categories[row.points_type]) categories[row.points_type] = [];
      if (categories[row.points_type].length < 3) {
        categories[row.points_type].push({
          userId: row.user_id,
          name: row.name,
          points: parseInt(row.points_in_category),
          transactions: parseInt(row.transactions_in_category)
        });
      }
      return categories;
    }, {});
    
    // Preparar dados do ranking
    const ranking = rankingResult.rows.map((row, index) => ({
      position: row.position,
      userId: row.user_id,
      name: row.name,
      email: row.email,
      pointsThisWeek: parseInt(row.points_this_week),
      transactionsThisWeek: parseInt(row.transactions_this_week),
      totalPoints: parseInt(row.total_points),
      currentLevel: row.current_level,
      isCurrentUser: userId === row.user_id,
      badge: (() => {
        if (row.position === 1) return { type: 'gold', name: '🥇 Campeão da Semana' };
        if (row.position === 2) return { type: 'silver', name: '🥈 Vice-Campeão' };
        if (row.position === 3) return { type: 'bronze', name: '🥉 Terceiro Lugar' };
        if (row.position <= 10) return { type: 'top10', name: '⭐ Top 10' };
        return null;
      })()
    }));
    
    // Calcular estatísticas do período
    const statistics = {
      period: {
        start: weekStart,
        end: weekEnd,
        weekNumber: getWeekNumber(weekStart),
        year: weekStart.getFullYear(),
        isCurrentWeek: isCurrentWeek(weekStart, weekEnd)
      },
      participants: {
        total: parseInt(weekStats.active_users),
        inRanking: ranking.length,
        userPosition: userPosition ? userPosition.position : null,
        userInTop10: userPosition ? userPosition.position <= 10 : false,
        userInTop50: userPosition ? userPosition.position <= 50 : false
      },
      points: {
        totalEarned: parseInt(weekStats.total_points_earned),
        averagePerTransaction: Math.round(parseFloat(weekStats.avg_points_per_transaction) || 0),
        averagePerUser: ranking.length > 0 ? 
          Math.round(parseInt(weekStats.total_points_earned) / parseInt(weekStats.active_users)) : 0,
        highestSingleTransaction: parseInt(weekStats.highest_single_transaction) || 0,
        leaderPoints: ranking.length > 0 ? ranking[0].pointsThisWeek : 0
      },
      transactions: {
        total: parseInt(weekStats.total_transactions),
        averagePerUser: parseInt(weekStats.active_users) > 0 ? 
          Math.round(parseInt(weekStats.total_transactions) / parseInt(weekStats.active_users)) : 0
      }
    };
    
    // Preparar resposta
    const responseData = {
      ranking,
      userPosition,
      statistics,
      topByCategory,
      filters: {
        userId: userId || null,
        limit,
        week: week || null
      }
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Ranking semanal obtido com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'get weekly ranking');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

// Função auxiliar para obter número da semana
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Função auxiliar para verificar se é a semana atual
function isCurrentWeek(weekStart, weekEnd) {
  const now = new Date();
  return now >= weekStart && now <= weekEnd;
}

