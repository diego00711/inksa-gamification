// api/gamification/utils/auth.js
// Utilitário para autenticação e validação

const jwt = require('jsonwebtoken');

// Função para verificar token JWT
function verifyToken(token) {
  try {
    if (!token) {
      throw new Error('Token não fornecido');
    }
    
    // Remove 'Bearer ' se presente
    const cleanToken = token.replace('Bearer ', '');
    
    const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
    return decoded;
  } catch (error) {
    console.error('Token verification error:', error);
    throw new Error('Token inválido');
  }
}

// Função para verificar chave de API interna
function verifyApiKey(apiKey) {
  try {
    if (!apiKey) {
      throw new Error('API Key não fornecida');
    }
    
    if (apiKey !== process.env.API_SECRET_KEY) {
      throw new Error('API Key inválida');
    }
    
    return true;
  } catch (error) {
    console.error('API Key verification error:', error);
    throw error;
  }
}

// Middleware para autenticação de usuário
function authenticateUser(req) {
  try {
    const authHeader = req.headers.authorization;
    const apiKey = req.headers['x-api-key'];
    
    // Verificar se é uma chamada interna com API Key
    if (apiKey) {
      verifyApiKey(apiKey);
      return { isInternal: true };
    }
    
    // Verificar token JWT para usuários
    if (!authHeader) {
      throw new Error('Token de autorização não fornecido');
    }
    
    const decoded = verifyToken(authHeader);
    return { 
      isInternal: false, 
      userId: decoded.userId || decoded.id,
      email: decoded.email 
    };
    
  } catch (error) {
    console.error('Authentication error:', error);
    throw error;
  }
}

// Função para validar parâmetros obrigatórios
function validateRequiredParams(params, requiredFields) {
  const missing = [];
  
  for (const field of requiredFields) {
    if (!params[field] && params[field] !== 0) {
      missing.push(field);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Parâmetros obrigatórios ausentes: ${missing.join(', ')}`);
  }
  
  return true;
}

// Função para validar tipos de dados
function validateDataTypes(data, schema) {
  const errors = [];
  
  for (const [field, expectedType] of Object.entries(schema)) {
    if (data[field] !== undefined) {
      const actualType = typeof data[field];
      
      if (expectedType === 'integer') {
        if (!Number.isInteger(Number(data[field]))) {
          errors.push(`${field} deve ser um número inteiro`);
        }
      } else if (expectedType === 'number') {
        if (isNaN(Number(data[field]))) {
          errors.push(`${field} deve ser um número`);
        }
      } else if (actualType !== expectedType) {
        errors.push(`${field} deve ser do tipo ${expectedType}, recebido ${actualType}`);
      }
    }
  }
  
  if (errors.length > 0) {
    throw new Error(`Erros de validação: ${errors.join(', ')}`);
  }
  
  return true;
}

// Função para sanitizar entrada de dados
function sanitizeInput(input) {
  if (typeof input === 'string') {
    return input.trim().replace(/[<>]/g, '');
  }
  
  if (typeof input === 'object' && input !== null) {
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  
  return input;
}

// Função para criar resposta padronizada
function createResponse(success, data = null, message = null, statusCode = 200) {
  return {
    success,
    data,
    message,
    timestamp: new Date().toISOString(),
    statusCode
  };
}

// Função para lidar com erros
function handleError(error, context = '') {
  console.error(`Error in ${context}:`, error);
  
  let statusCode = 500;
  let message = 'Erro interno do servidor';
  
  if (error.message.includes('Token')) {
    statusCode = 401;
    message = 'Não autorizado';
  } else if (error.message.includes('API Key')) {
    statusCode = 401;
    message = 'API Key inválida';
  } else if (error.message.includes('obrigatórios') || error.message.includes('validação')) {
    statusCode = 400;
    message = error.message;
  } else if (error.message.includes('não encontrado')) {
    statusCode = 404;
    message = error.message;
  }
  
  return createResponse(false, null, message, statusCode);
}

// Função para lidar com CORS preflight
function handleCors(req) {
  if (req.method === 'OPTIONS') {
    return {
      statusCode: 200
    };
  }
  return null;
}

module.exports = {
  verifyToken,
  verifyApiKey,
  authenticateUser,
  validateRequiredParams,
  validateDataTypes,
  sanitizeInput,
  createResponse,
  handleError,
  handleCors
};

