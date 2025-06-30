// api/gamification/utils/database.js
// Utilitário para conexão com banco de dados PostgreSQL (Supabase)

const { Pool } = require('pg');

let pool;

// Função para obter conexão com o banco de dados
function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      },
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}

// Função para executar queries
async function query(text, params) {
  const client = getPool();
  try {
    const result = await client.query(text, params);
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// Função para executar transações
async function transaction(queries) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const results = [];
    
    for (const { text, params } of queries) {
      const result = await client.query(text, params);
      results.push(result);
    }
    
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transaction error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Função para verificar se usuário existe
async function getUserById(userId) {
  try {
    const result = await query(
      'SELECT id, email, name, phone, created_at FROM users WHERE id = $1',
      [userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting user:', error);
    throw error;
  }
}

// Função para obter ou criar registro de pontos do usuário
async function getUserPoints(userId) {
  try {
    let result = await query(
      'SELECT * FROM user_points WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      // Criar registro de pontos para o usuário
      result = await query(
        `INSERT INTO user_points (user_id, total_points, current_level, points_to_next_level) 
         VALUES ($1, 0, 1, 100) 
         RETURNING *`,
        [userId]
      );
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Error getting user points:', error);
    throw error;
  }
}

// Função para calcular nível baseado nos pontos
async function calculateLevel(totalPoints) {
  try {
    const result = await query(
      `SELECT level_number, level_name, points_required, benefits 
       FROM levels 
       WHERE points_required <= $1 
       ORDER BY points_required DESC 
       LIMIT 1`,
      [totalPoints]
    );
    
    if (result.rows.length === 0) {
      // Retorna nível 1 se não encontrar nenhum nível
      return {
        level_number: 1,
        level_name: 'Iniciante',
        points_required: 0,
        benefits: '{"discount": 0, "free_delivery": false}'
      };
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Error calculating level:', error);
    throw error;
  }
}

// Função para obter próximo nível
async function getNextLevel(currentLevel) {
  try {
    const result = await query(
      `SELECT level_number, level_name, points_required, benefits 
       FROM levels 
       WHERE level_number > $1 
       ORDER BY level_number ASC 
       LIMIT 1`,
      [currentLevel]
    );
    
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting next level:', error);
    throw error;
  }
}

// Função para adicionar pontos ao usuário
async function addPointsToUser(userId, points, pointsType, description, orderId = null) {
  try {
    const queries = [
      // Adicionar ao histórico
      {
        text: `INSERT INTO points_history (user_id, points_earned, points_type, description, order_id) 
               VALUES ($1, $2, $3, $4, $5)`,
        params: [userId, points, pointsType, description, orderId]
      },
      // Atualizar total de pontos
      {
        text: `UPDATE user_points 
               SET total_points = total_points + $2, updated_at = CURRENT_TIMESTAMP 
               WHERE user_id = $1`,
        params: [userId, points]
      }
    ];
    
    await transaction(queries);
    
    // Recalcular nível
    const userPoints = await getUserPoints(userId);
    const currentLevel = await calculateLevel(userPoints.total_points);
    const nextLevel = await getNextLevel(currentLevel.level_number);
    
    const pointsToNextLevel = nextLevel ? 
      nextLevel.points_required - userPoints.total_points : 0;
    
    // Atualizar nível se necessário
    if (currentLevel.level_number !== userPoints.current_level) {
      await query(
        `UPDATE user_points 
         SET current_level = $2, points_to_next_level = $3, updated_at = CURRENT_TIMESTAMP 
         WHERE user_id = $1`,
        [userId, currentLevel.level_number, pointsToNextLevel]
      );
    } else {
      await query(
        `UPDATE user_points 
         SET points_to_next_level = $2, updated_at = CURRENT_TIMESTAMP 
         WHERE user_id = $1`,
        [userId, pointsToNextLevel]
      );
    }
    
    return {
      success: true,
      newTotal: userPoints.total_points + points,
      currentLevel: currentLevel.level_number,
      pointsToNextLevel: pointsToNextLevel
    };
    
  } catch (error) {
    console.error('Error adding points:', error);
    throw error;
  }
}

module.exports = {
  query,
  transaction,
  getUserById,
  getUserPoints,
  calculateLevel,
  getNextLevel,
  addPointsToUser
};

