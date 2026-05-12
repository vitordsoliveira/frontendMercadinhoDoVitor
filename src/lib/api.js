const DEFAULT_API_URL = 'http://127.0.0.1:3223';
const SESSION_STORAGE_KEY = 'mercadinho.session';
const SESSION_UPDATE_EVENT = 'mercadinho:session-updated';

function normalizeBaseUrl(baseUrl) {
  const sanitized = String(baseUrl || DEFAULT_API_URL).trim();
  return sanitized.replace(/\/+$/, '');
}

function readStoredSession() {
  try {
    const rawValue = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return rawValue ? JSON.parse(rawValue) : {};
  } catch (error) {
    return {};
  }
}

function writeStoredSession(nextSession) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
  window.dispatchEvent(
    new CustomEvent(SESSION_UPDATE_EVENT, {
      detail: nextSession,
    }),
  );
}

async function parseResponse(response) {
  const rawBody = await response.text();

  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new Error('A API respondeu em um formato inesperado.');
  }
}

function buildErrorMessage(data, fallbackMessage) {
  return data.error || data.message || data.msg || fallbackMessage;
}

function expireStoredSession() {
  const storedSession = readStoredSession();
  writeStoredSession({
    ...storedSession,
    accessToken: '',
  });
}

async function request(baseUrl, path, options = {}) {
  const storedSession = readStoredSession();
  const bearerToken =
    options.auth === true ? options.token || storedSession.accessToken : options.token;

  const headers = {
    Accept: 'application/json',
    ...options.headers,
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await parseResponse(response);

  if (response.status === 401 && options.auth === true) {
    expireStoredSession();
    throw new Error('Sua sessao expirou. Faca login novamente.');
  }

  if (!response.ok) {
    throw new Error(buildErrorMessage(data, 'Nao foi possivel concluir a requisicao.'));
  }

  return data;
}

export const mercadinhoApi = {
  health(baseUrl) {
    return request(baseUrl, '/api');
  },
  createSeller(baseUrl, payload) {
    return request(baseUrl, '/api/sellers', {
      method: 'POST',
      body: payload,
    });
  },
  activateSeller(baseUrl, payload) {
    return request(baseUrl, '/api/sellers/activate', {
      method: 'POST',
      body: payload,
    });
  },
  login(baseUrl, payload) {
    const storedSession = readStoredSession();
    const sellerToken = payload.token?.trim() || storedSession.sellerToken;

    return request(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: sellerToken ? { ...payload, token: sellerToken } : payload,
    });
  },
  listProducts(baseUrl, token) {
    return request(baseUrl, '/api/products', {
      token,
      auth: true,
    });
  },
  createProduct(baseUrl, token, payload) {
    return request(baseUrl, '/api/products', {
      method: 'POST',
      token,
      auth: true,
      body: payload,
    });
  },
  updateProduct(baseUrl, token, productId, payload) {
    return request(baseUrl, `/api/products/${productId}`, {
      method: 'PUT',
      token,
      auth: true,
      body: payload,
    });
  },
  inactivateProduct(baseUrl, token, productId) {
    return request(baseUrl, `/api/products/${productId}/inactivate`, {
      method: 'PATCH',
      token,
      auth: true,
    });
  },
  createSale(baseUrl, token, payload) {
    return request(baseUrl, '/api/sales', {
      method: 'POST',
      token,
      auth: true,
      body: payload,
    });
  },
  listSales(baseUrl, token) {
    return request(baseUrl, '/api/sales', {
      token,
      auth: true,
    });
  },
};
