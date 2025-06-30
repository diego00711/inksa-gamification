// api/gamification/badges/available.js
// API para listar distintivos disponíveis

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
    const userId = parseInt(req.query.userId); // Para mostrar quais o usuário já possui
    const category = req.query.category; // Filtrar por categoria
    const includeEarned = req.query.includeEarned !== 'false'; // Incluir distintivos já conquistados
    
    // Obter todos os distintivos disponíveis
    let badgesQuery = `
      SELECT 
        id,
        name,
        description,
        icon_url,
        criteria,
        points_reward,
        is_active
      FROM badges 
      WHERE is_active = true
    `;
    
    const queryParams = [];
    
    // Adicionar filtro por categoria se fornecido
    if (category) {
      // Filtrar baseado no critério (isso pode ser melhorado com uma coluna category na tabela)
      badgesQuery += ` AND criteria LIKE $${queryParams.length + 1}`;
      queryParams.push(`%"${category}"%`);
    }
    
    badgesQuery += ` ORDER BY points_reward ASC, name ASC`;
    
    const badgesResult = await query(badgesQuery, queryParams);
    
    // Se userId foi fornecido, obter distintivos que o usuário já possui
    let userBadgeIds = [];
    if (userId) {
      // Verificar autorização se não for chamada interna
      if (!auth.isInternal && auth.userId !== userId) {
        return res.status(403).json(createResponse(false, null, 'Não autorizado a ver informações deste usuário', 403));
      }
      
      const userBadgesResult = await query(`
        SELECT badge_id, earned_at 
        FROM user_badges 
        WHERE user_id = $1
      `, [userId]);
      
      userBadgeIds = userBadgesResult.rows.map(row => ({
        badgeId: row.badge_id,
        earnedAt: row.earned_at
      }));
    }
    
    // Obter estatísticas de cada distintivo
    const badgeStatsResult = await query(`
      SELECT 
        badge_id,
        COUNT(*) as times_earned,
        MAX(earned_at) as last_earned,
        MIN(earned_at) as first_earned
      FROM user_badges
      GROUP BY badge_id
    `);
    
    const badgeStats = badgeStatsResult.rows.reduce((stats, row) => {
      stats[row.badge_id] = {
        timesEarned: parseInt(row.times_earned),
        lastEarned: row.last_earned,
        firstEarned: row.first_earned
      };
      return stats;
    }, {});
    
    // Preparar dados dos distintivos
    const badges = badgesResult.rows.map(badge => {
      const userBadge = userBadgeIds.find(ub => ub.badgeId === badge.id);
      const stats = badgeStats[badge.id] || { timesEarned: 0, lastEarned: null, firstEarned: null };
      const criteria = JSON.parse(badge.criteria);
      
      // Determinar categoria baseada no critério
      let category = 'outros';
      if (criteria.orders) category = 'pedidos';
      else if (criteria.reviews) category = 'avaliacoes';
      else if (criteria.referrals) category = 'indicacoes';
      else if (criteria.time) category = 'horarios';
      else if (criteria.different_restaurants) category = 'exploracao';
      else if (criteria.total_spent) category = 'gastos';
      
      // Determinar dificuldade baseada nos critérios
      let difficulty = 'facil';
      if (criteria.orders && criteria.orders >= 50) difficulty = 'dificil';
      else if (criteria.orders && criteria.orders >= 20) difficulty = 'medio';
      else if (criteria.total_spent && criteria.total_spent >= 1000) difficulty = 'dificil';
      else if (criteria.total_spent && criteria.total_spent >= 300) difficulty = 'medio';
      else if (criteria.referrals && criteria.referrals >= 10) difficulty = 'dificil';
      else if (criteria.referrals && criteria.referrals >= 5) difficulty = 'medio';
      
      return {
        id: badge.id,
        name: badge.name,
        description: badge.description,
        iconUrl: badge.icon_url,
        criteria: criteria,
        pointsReward: badge.points_reward,
        category: category,
        difficulty: difficulty,
        isEarned: !!userBadge,
        earnedAt: userBadge ? userBadge.earnedAt : null,
        statistics: stats,
        rarity: stats.timesEarned === 0 ? 'nao_conquistado' :
                stats.timesEarned <= 5 ? 'muito_raro' :
                stats.timesEarned <= 20 ? 'raro' :
                stats.timesEarned <= 100 ? 'comum' : 'muito_comum'
      };
    });
    
    // Filtrar distintivos já conquistados se solicitado
    const filteredBadges = includeEarned ? badges : badges.filter(badge => !badge.isEarned);
    
    // Agrupar por categoria
    const badgesByCategory = filteredBadges.reduce((categories, badge) => {
      if (!categories[badge.category]) categories[badge.category] = [];
      categories[badge.category].push(badge);
      return categories;
    }, {});
    
    // Agrupar por dificuldade
    const badgesByDifficulty = filteredBadges.reduce((difficulties, badge) => {
      if (!difficulties[badge.difficulty]) difficulties[badge.difficulty] = [];
      difficulties[badge.difficulty].push(badge);
      return difficulties;
    }, {});
    
    // Calcular estatísticas gerais
    const statistics = {
      totalBadges: badges.length,
      earnedBadges: badges.filter(b => b.isEarned).length,
      availableBadges: badges.filter(b => !b.isEarned).length,
      totalPointsAvailable: badges.filter(b => !b.isEarned).reduce((sum, b) => sum + b.pointsReward, 0),
      categoryCounts: Object.keys(badgesByCategory).reduce((counts, category) => {
        counts[category] = badgesByCategory[category].length;
        return counts;
      }, {}),
      difficultyCounts: Object.keys(badgesByDifficulty).reduce((counts, difficulty) => {
        counts[difficulty] = badgesByDifficulty[difficulty].length;
        return counts;
      }, {}),
      rarestBadges: badges.filter(b => b.rarity === 'muito_raro' || b.rarity === 'nao_conquistado').slice(0, 5)
    };
    
    // Preparar resposta
    const responseData = {
      badges: filteredBadges,
      badgesByCategory,
      badgesByDifficulty,
      statistics,
      filters: {
        userId: userId || null,
        category: category || null,
        includeEarned
      },
      categories: {
        pedidos: 'Distintivos relacionados a pedidos',
        avaliacoes: 'Distintivos por avaliar pedidos',
        indicacoes: 'Distintivos por indicar amigos',
        horarios: 'Distintivos por horários especiais',
        exploracao: 'Distintivos por explorar restaurantes',
        gastos: 'Distintivos por valor gasto',
        outros: 'Outros distintivos especiais'
      },
      difficulties: {
        facil: 'Fácil de conquistar',
        medio: 'Dificuldade média',
        dificil: 'Difícil de conquistar'
      }
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Distintivos disponíveis obtidos com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'get available badges');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

