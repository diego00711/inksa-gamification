// api/gamification/badges/user.js
// API para obter distintivos do usuário

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
    
    // Validar parâmetros obrigatórios
    if (!userId) {
      return res.status(400).json(createResponse(false, null, 'userId é obrigatório', 400));
    }
    
    // Verificar se o usuário existe
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createResponse(false, null, 'Usuário não encontrado', 404));
    }
    
    // Verificar autorização (usuário só pode ver seus próprios distintivos, exceto chamadas internas)
    if (!auth.isInternal && auth.userId !== userId) {
      return res.status(403).json(createResponse(false, null, 'Não autorizado a ver distintivos deste usuário', 403));
    }
    
    // Obter distintivos do usuário
    const userBadgesResult = await query(`
      SELECT 
        b.id,
        b.name,
        b.description,
        b.icon_url,
        b.criteria,
        b.points_reward,
        ub.earned_at
      FROM user_badges ub
      JOIN badges b ON ub.badge_id = b.id
      WHERE ub.user_id = $1
      ORDER BY ub.earned_at DESC
    `, [userId]);
    
    // Obter total de distintivos disponíveis
    const totalBadgesResult = await query(`
      SELECT COUNT(*) as total 
      FROM badges 
      WHERE is_active = true
    `);
    
    const totalAvailableBadges = parseInt(totalBadgesResult.rows[0].total);
    
    // Obter distintivos mais recentes de outros usuários (para inspiração)
    const recentBadgesResult = await query(`
      SELECT 
        b.name,
        b.description,
        COUNT(*) as times_earned,
        MAX(ub.earned_at) as last_earned
      FROM user_badges ub
      JOIN badges b ON ub.badge_id = b.id
      WHERE ub.earned_at >= NOW() - INTERVAL '30 days'
      GROUP BY b.id, b.name, b.description
      ORDER BY times_earned DESC, last_earned DESC
      LIMIT 5
    `);
    
    // Preparar dados dos distintivos do usuário
    const userBadges = userBadgesResult.rows.map(badge => ({
      id: badge.id,
      name: badge.name,
      description: badge.description,
      iconUrl: badge.icon_url,
      criteria: JSON.parse(badge.criteria),
      pointsReward: badge.points_reward,
      earnedAt: badge.earned_at,
      daysAgo: Math.floor((new Date() - new Date(badge.earned_at)) / (1000 * 60 * 60 * 24))
    }));
    
    // Agrupar distintivos por categoria (baseado no tipo de critério)
    const badgesByCategory = userBadges.reduce((categories, badge) => {
      const criteria = badge.criteria;
      let category = 'outros';
      
      if (criteria.orders) category = 'pedidos';
      else if (criteria.reviews) category = 'avaliacoes';
      else if (criteria.referrals) category = 'indicacoes';
      else if (criteria.time) category = 'horarios';
      else if (criteria.different_restaurants) category = 'exploracao';
      else if (criteria.total_spent) category = 'gastos';
      
      if (!categories[category]) categories[category] = [];
      categories[category].push(badge);
      
      return categories;
    }, {});
    
    // Calcular estatísticas
    const statistics = {
      totalEarned: userBadges.length,
      totalAvailable: totalAvailableBadges,
      completionPercentage: totalAvailableBadges > 0 ? 
        Math.round((userBadges.length / totalAvailableBadges) * 100) : 0,
      totalPointsFromBadges: userBadges.reduce((sum, badge) => sum + badge.pointsReward, 0),
      mostRecentBadge: userBadges.length > 0 ? userBadges[0] : null,
      badgesThisMonth: userBadges.filter(badge => {
        const earnedDate = new Date(badge.earnedAt);
        const now = new Date();
        return earnedDate.getMonth() === now.getMonth() && 
               earnedDate.getFullYear() === now.getFullYear();
      }).length
    };
    
    // Preparar dados dos distintivos populares
    const popularBadges = recentBadgesResult.rows.map(badge => ({
      name: badge.name,
      description: badge.description,
      timesEarned: parseInt(badge.times_earned),
      lastEarned: badge.last_earned
    }));
    
    // Preparar resposta
    const responseData = {
      userId,
      badges: userBadges,
      badgesByCategory,
      statistics,
      popularBadges,
      categories: {
        pedidos: 'Distintivos relacionados a pedidos',
        avaliacoes: 'Distintivos por avaliar pedidos',
        indicacoes: 'Distintivos por indicar amigos',
        horarios: 'Distintivos por horários especiais',
        exploracao: 'Distintivos por explorar restaurantes',
        gastos: 'Distintivos por valor gasto',
        outros: 'Outros distintivos especiais'
      }
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Distintivos obtidos com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'get user badges');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

