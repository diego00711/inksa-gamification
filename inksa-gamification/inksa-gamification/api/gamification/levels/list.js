// api/gamification/levels/list.js
// API para listar todos os níveis disponíveis

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
    
    // Autenticar usuário ou verificar API key (esta é uma rota pública, mas ainda requer autenticação)
    const auth = authenticateUser(req);
    
    // Obter parâmetros opcionais
    const includeStats = req.query.includeStats === 'true';
    const userId = parseInt(req.query.userId); // Para destacar o nível atual do usuário
    
    // Obter todos os níveis
    const levelsResult = await query(`
      SELECT 
        level_number,
        level_name,
        points_required,
        benefits
      FROM levels 
      ORDER BY level_number ASC
    `);
    
    let userCurrentLevel = null;
    
    // Se userId foi fornecido, obter o nível atual do usuário
    if (userId) {
      // Verificar autorização se não for chamada interna
      if (!auth.isInternal && auth.userId !== userId) {
        return res.status(403).json(createResponse(false, null, 'Não autorizado a ver informações deste usuário', 403));
      }
      
      const userPointsResult = await query(`
        SELECT total_points, current_level 
        FROM user_points 
        WHERE user_id = $1
      `, [userId]);
      
      if (userPointsResult.rows.length > 0) {
        userCurrentLevel = userPointsResult.rows[0].current_level;
      }
    }
    
    // Preparar dados dos níveis
    const levels = levelsResult.rows.map((level, index) => {
      const nextLevel = levelsResult.rows[index + 1];
      const previousLevel = levelsResult.rows[index - 1];
      
      return {
        number: level.level_number,
        name: level.level_name,
        pointsRequired: level.points_required,
        benefits: JSON.parse(level.benefits),
        isCurrentUserLevel: userCurrentLevel === level.level_number,
        pointsToReach: nextLevel ? nextLevel.points_required - level.points_required : 0,
        benefitImprovements: nextLevel ? (() => {
          const current = JSON.parse(level.benefits);
          const next = JSON.parse(nextLevel.benefits);
          const improvements = {};
          
          for (const [key, value] of Object.entries(next)) {
            if (current[key] !== value) {
              improvements[key] = {
                current: current[key] || 0,
                next: value,
                improvement: typeof value === 'number' && typeof current[key] === 'number' ? 
                  value - (current[key] || 0) : null
              };
            }
          }
          
          return improvements;
        })() : null
      };
    });
    
    // Obter estatísticas se solicitado
    let statistics = null;
    if (includeStats) {
      // Estatísticas gerais dos níveis
      const statsResult = await query(`
        SELECT 
          l.level_number,
          l.level_name,
          COUNT(up.user_id) as users_count,
          AVG(up.total_points) as avg_points_in_level
        FROM levels l
        LEFT JOIN user_points up ON up.current_level = l.level_number
        GROUP BY l.level_number, l.level_name
        ORDER BY l.level_number ASC
      `);
      
      // Total de usuários no sistema
      const totalUsersResult = await query(`
        SELECT COUNT(*) as total_users 
        FROM user_points
      `);
      
      const totalUsers = parseInt(totalUsersResult.rows[0].total_users);
      
      statistics = {
        totalUsers,
        levelDistribution: statsResult.rows.map(row => ({
          levelNumber: row.level_number,
          levelName: row.level_name,
          usersCount: parseInt(row.users_count),
          percentage: totalUsers > 0 ? Math.round((parseInt(row.users_count) / totalUsers) * 100) : 0,
          averagePointsInLevel: Math.round(parseFloat(row.avg_points_in_level) || 0)
        })),
        mostPopularLevel: statsResult.rows.reduce((max, current) => 
          parseInt(current.users_count) > parseInt(max.users_count) ? current : max, 
          statsResult.rows[0]
        )
      };
    }
    
    // Preparar resposta
    const responseData = {
      levels,
      totalLevels: levels.length,
      userCurrentLevel: userCurrentLevel,
      statistics: statistics
    };
    
    // Retornar resposta de sucesso
    return res.status(200).json(createResponse(true, responseData, 'Níveis obtidos com sucesso'));
    
  } catch (error) {
    const errorResponse = handleError(error, 'list levels');
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
};

