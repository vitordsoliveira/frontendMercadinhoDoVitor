import { useDeferredValue, useEffect, useRef, useState, useTransition } from 'react';
import { mercadinhoApi } from './lib/api';

const DEFAULT_API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3223';
const SESSION_STORAGE_KEY = 'mercadinho.session';
const SESSION_UPDATE_EVENT = 'mercadinho:session-updated';

const EMPTY_SESSION = {
  accessToken: '',
  sellerToken: '',
  seller: null,
};

const EMPTY_FEEDBACK = {
  tone: '',
  text: '',
};

const EMPTY_REGISTER_FORM = {
  nome: '',
  cnpj: '',
  email: '',
  celular: '',
  senha: '',
};

const EMPTY_ACTIVATE_FORM = {
  celular: '',
  codigo: '',
};

const EMPTY_LOGIN_FORM = {
  email: '',
  senha: '',
  token: '',
};

const EMPTY_PRODUCT_FORM = {
  nome: '',
  preco: '',
  quantidade: '',
  status: 'Ativo',
  imagem: '',
};

const EMPTY_SALE_FORM = {
  produtoId: '',
  quantidade: '1',
};

function readStorage(key, fallbackValue) {
  try {
    const rawValue = window.localStorage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : fallbackValue;
  } catch (error) {
    return fallbackValue;
  }
}

function saveStorage(key, value) {
  const nextValue = JSON.stringify(value);

  if (window.localStorage.getItem(key) === nextValue) {
    return;
  }

  window.localStorage.setItem(key, nextValue);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

function App() {
  const apiUrl = readStorage('mercadinho.apiUrl', DEFAULT_API_URL);
  const [session, setSession] = useState(() => readStorage('mercadinho.session', EMPTY_SESSION));
  const [feedback, setFeedback] = useState(EMPTY_FEEDBACK);
  const [registerForm, setRegisterForm] = useState(EMPTY_REGISTER_FORM);
  const [activateForm, setActivateForm] = useState(EMPTY_ACTIVATE_FORM);
  const [loginForm, setLoginForm] = useState(() => {
    const storedSession = readStorage('mercadinho.session', EMPTY_SESSION);
    return {
      ...EMPTY_LOGIN_FORM,
      token: storedSession.sellerToken || '',
      email: storedSession.seller?.email || '',
    };
  });
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT_FORM);
  const [saleForm, setSaleForm] = useState(EMPTY_SALE_FORM);
  const [products, setProducts] = useState([]);
  const [editingProductId, setEditingProductId] = useState(null);
  const fileInputRef = useRef(null);
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [busyAction, setBusyAction] = useState('');
  const [productsLoading, setProductsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [sales, setSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);

  useEffect(() => {
    saveStorage(SESSION_STORAGE_KEY, session);
  }, [session]);

  useEffect(() => {
    function syncSessionFromStorage(nextSession) {
      if (!nextSession || typeof nextSession !== 'object') {
        return;
      }

      setSession({
        accessToken: nextSession.accessToken || '',
        sellerToken: nextSession.sellerToken || '',
        seller: nextSession.seller || null,
      });

      setLoginForm((currentValue) => ({
        ...currentValue,
        email: nextSession.seller?.email || currentValue.email,
        token: nextSession.sellerToken || currentValue.token,
      }));
    }

    function handleSessionUpdate(event) {
      syncSessionFromStorage(event.detail);
    }

    function handleStorage(event) {
      if (event.key !== SESSION_STORAGE_KEY || !event.newValue) {
        return;
      }

      try {
        syncSessionFromStorage(JSON.parse(event.newValue));
      } catch (error) {
        return;
      }
    }

    window.addEventListener(SESSION_UPDATE_EVENT, handleSessionUpdate);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(SESSION_UPDATE_EVENT, handleSessionUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setFeedback((currentValue) => (currentValue.text ? EMPTY_FEEDBACK : currentValue));
    }, 5000);

    return () => window.clearTimeout(timeoutId);
  }, [feedback]);

  useEffect(() => {
    if (!session.accessToken) {
      setProducts([]);
      setSales([]);
      return;
    }

    loadProducts();
    loadSales();
  }, [apiUrl, session.accessToken]);

  useEffect(() => {
    if (session.sellerToken) {
      setLoginForm((currentValue) => ({
        ...currentValue,
        token: currentValue.token || session.sellerToken,
      }));
    }
  }, [session.sellerToken]);

  useEffect(() => {
    const saleCandidates = products.filter(
      (product) => product.status === 'Ativo' && product.quantidade > 0,
    );

    if (!saleCandidates.length) {
      setSaleForm(EMPTY_SALE_FORM);
      return;
    }

    const selectedProductStillExists = saleCandidates.some(
      (product) => String(product.id) === String(saleForm.produtoId),
    );

    if (!selectedProductStillExists) {
      setSaleForm((currentValue) => ({
        ...currentValue,
        produtoId: String(saleCandidates[0].id),
      }));
    }
  }, [products, saleForm.produtoId]);

  const filteredProducts = products.filter((product) => {
    const searchBase = [product.nome, product.status, String(product.id)].join(' ').toLowerCase();
    return searchBase.includes(deferredSearchTerm.trim().toLowerCase());
  });

  async function runAction(actionName, callback) {
    setBusyAction(actionName);

    try {
      await callback();
    } catch (error) {
      showFeedback('danger', error.message);
    } finally {
      setBusyAction('');
    }
  }

  function showFeedback(tone, text) {
    setFeedback({ tone, text });
  }

  async function loadProducts(tokenOverride) {
    const effectiveToken =
      typeof tokenOverride === 'string' && tokenOverride ? tokenOverride : session.accessToken;

    if (!effectiveToken) {
      return;
    }

    setProductsLoading(true);

    try {
      const data = await mercadinhoApi.listProducts(apiUrl, effectiveToken);
      startTransition(() => {
        setProducts(data.products || []);
      });
    } catch (error) {
      showFeedback('danger', error.message);
    } finally {
      setProductsLoading(false);
    }
  }

  async function loadSales(tokenOverride) {
    const effectiveToken =
      typeof tokenOverride === 'string' && tokenOverride ? tokenOverride : session.accessToken;

    if (!effectiveToken) {
      return;
    }

    setSalesLoading(true);

    try {
      const data = await mercadinhoApi.listSales(apiUrl, effectiveToken);
      setSales(data.sales || []);
    } catch (error) {
      showFeedback('danger', error.message);
    } finally {
      setSalesLoading(false);
    }
  }

  function updateRegisterField(fieldName, value) {
    setRegisterForm((currentValue) => ({
      ...currentValue,
      [fieldName]: value,
    }));
  }

  function updateActivateField(fieldName, value) {
    setActivateForm((currentValue) => ({
      ...currentValue,
      [fieldName]: value,
    }));
  }

  function updateLoginField(fieldName, value) {
    setLoginForm((currentValue) => ({
      ...currentValue,
      [fieldName]: value,
    }));
  }

  function updateProductField(fieldName, value) {
    setProductForm((currentValue) => ({
      ...currentValue,
      [fieldName]: value,
    }));
  }

  function updateSaleField(fieldName, value) {
    setSaleForm((currentValue) => ({
      ...currentValue,
      [fieldName]: value,
    }));
  }

  function resetProductEditor() {
    setEditingProductId(null);
    setProductForm(EMPTY_PRODUCT_FORM);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleImageFileChange(event) {
    const file = event.target.files[0];
    if (!file) return;

    const allowedTypes = ['image/png', 'image/jpeg', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      showFeedback('danger', 'Formato nao permitido. Use PNG, JPG, JPEG ou PDF.');
      event.target.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showFeedback('danger', 'Arquivo muito grande. O limite e 10 MB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => updateProductField('imagem', e.target.result);
    reader.readAsDataURL(file);
  }

  function hydrateSession(data, fallbackToken = '') {
    const sellerToken = data.token || data.seller?.token || fallbackToken;

    setSession({
      accessToken: data.access_token || '',
      sellerToken,
      seller: data.seller || null,
    });

    setLoginForm((currentValue) => ({
      ...currentValue,
      email: data.seller?.email || currentValue.email,
      token: sellerToken || currentValue.token,
    }));
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault();

    await runAction('register', async () => {
      if (
        !registerForm.nome.trim() ||
        !registerForm.cnpj.trim() ||
        !registerForm.email.trim() ||
        !registerForm.celular.trim() ||
        !registerForm.senha.trim()
      ) {
        throw new Error('Preencha todos os campos do cadastro.');
      }

      const data = await mercadinhoApi.createSeller(apiUrl, registerForm);
      setRegisterForm(EMPTY_REGISTER_FORM);
      setActivateForm((currentValue) => ({
        ...currentValue,
        celular: data.seller?.celular || currentValue.celular,
      }));
      setLoginForm((currentValue) => ({
        ...currentValue,
        email: data.seller?.email || currentValue.email,
      }));
      showFeedback('success', data.message || 'Seller cadastrado com sucesso.');
    });
  }

  async function handleActivateSubmit(event) {
    event.preventDefault();

    await runAction('activate', async () => {
      if (!activateForm.celular.trim() || !activateForm.codigo.trim()) {
        throw new Error('Informe celular e codigo de ativacao.');
      }

      const data = await mercadinhoApi.activateSeller(apiUrl, activateForm);
      hydrateSession(data, data.token);
      setActivateForm(EMPTY_ACTIVATE_FORM);
      showFeedback('success', data.message || 'Conta ativada com sucesso.');
      await loadProducts(data.access_token);
      await loadSales(data.access_token);
    });
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();

    await runAction('login', async () => {
      if (!loginForm.email.trim() || !loginForm.senha.trim()) {
        throw new Error('Informe e-mail e senha para entrar.');
      }

      const payload = {
        email: loginForm.email,
        senha: loginForm.senha,
      };

      if (loginForm.token.trim()) {
        payload.token = loginForm.token.trim();
      }

      const data = await mercadinhoApi.login(apiUrl, payload);
      hydrateSession(data, loginForm.token.trim());
      setLoginForm((currentValue) => ({
        ...currentValue,
        senha: '',
      }));
      showFeedback('success', data.message || 'Login realizado com sucesso.');
      await loadProducts(data.access_token);
      await loadSales(data.access_token);
    });
  }

  async function handleProductSubmit(event) {
    event.preventDefault();

    await runAction('product', async () => {
      if (!productForm.nome.trim() || productForm.preco === '' || productForm.quantidade === '') {
        throw new Error('Preencha nome, preco e quantidade do produto.');
      }

      const payload = {
        nome: productForm.nome.trim(),
        preco: Number(productForm.preco),
        quantidade: Number(productForm.quantidade),
        status: productForm.status,
        imagem: productForm.imagem.trim(),
      };

      if (!payload.imagem) {
        delete payload.imagem;
      }

      const data = editingProductId
        ? await mercadinhoApi.updateProduct(apiUrl, session.accessToken, editingProductId, payload)
        : await mercadinhoApi.createProduct(apiUrl, session.accessToken, payload);

      showFeedback('success', data.message || 'Produto salvo com sucesso.');
      resetProductEditor();
      await loadProducts();
    });
  }

  async function handleInactivateProduct(productId) {
    await runAction(`inactivate-${productId}`, async () => {
      const data = await mercadinhoApi.inactivateProduct(apiUrl, session.accessToken, productId);
      showFeedback('success', data.message || 'Produto inativado.');
      await loadProducts();
    });
  }

  async function handleSaleSubmit(event) {
    event.preventDefault();

    await runAction('sale', async () => {
      if (!saleForm.produtoId || saleForm.quantidade === '') {
        throw new Error('Selecione um produto e informe a quantidade vendida.');
      }

      const data = await mercadinhoApi.createSale(apiUrl, session.accessToken, {
        produtoId: Number(saleForm.produtoId),
        quantidade: Number(saleForm.quantidade),
      });

      showFeedback(
        'success',
        `${data.message || 'Venda registrada.'} Total: ${formatCurrency(data.sale?.valor_total)}`,
      );
      setSaleForm((currentValue) => ({
        ...currentValue,
        quantidade: '1',
      }));
      await loadProducts();
      await loadSales();
    });
  }

  function handleEditProduct(product) {
    setEditingProductId(product.id);
    setProductForm({
      nome: product.nome,
      preco: String(product.preco),
      quantidade: String(product.quantidade),
      status: product.status,
      imagem: product.imagem || '',
    });
  }

  function handleLogout() {
    setSession(EMPTY_SESSION);
    setProducts([]);
    setSales([]);
    setEditingProductId(null);
    setSaleForm(EMPTY_SALE_FORM);
    showFeedback('neutral', 'Sessao encerrada neste navegador.');
  }

  return (
    <div className="page-shell">
      <div className="page-glow page-glow-left" />
      <div className="page-glow page-glow-right" />

      <main className="app">
        <h1 className="app-title">
          {session.seller?.nome || 'Mercadinho 🚽🪠'}
        </h1>

              <button className="danger-button" type="button" onClick={handleLogout}>
                Sair
              </button>

        {feedback.text ? (
          <div className={`feedback-banner feedback-${feedback.tone}`}>{feedback.text}</div>
        ) : null}

        {!session.accessToken ? (
        <section className="content-grid">

          <article className="panel auth-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-kicker">Autenticacao</span>
                <h2>Conta do Seller</h2>
              </div>
            </div>

            <div className="auth-grid">
              <form className="form-card" onSubmit={handleRegisterSubmit}>
                <h3>Cadastrar seller</h3>
                <label className="field">
                  <span>Nome do mercado</span>
                  <input
                    value={registerForm.nome}
                    onChange={(event) => updateRegisterField('nome', event.target.value)}
                    placeholder="Mercadinho Central"
                  />
                </label>
                <label className="field">
                  <span>CNPJ</span>
                  <input
                    value={registerForm.cnpj}
                    onChange={(event) => updateRegisterField('cnpj', event.target.value)}
                    placeholder="12345678000199"
                  />
                </label>
                <label className="field">
                  <span>E-mail</span>
                  <input
                    type="email"
                    value={registerForm.email}
                    onChange={(event) => updateRegisterField('email', event.target.value)}
                    placeholder="mercado@email.com"
                  />
                </label>
                <label className="field">
                  <span>Celular</span>
                  <input
                    value={registerForm.celular}
                    onChange={(event) => updateRegisterField('celular', event.target.value)}
                    placeholder="11999999999"
                  />
                </label>
                <label className="field">
                  <span>Senha</span>
                  <input
                    type="password"
                    value={registerForm.senha}
                    onChange={(event) => updateRegisterField('senha', event.target.value)}
                    placeholder="Sua senha"
                  />
                </label>

                <button className="primary-button" disabled={busyAction === 'register'} type="submit">
                  {busyAction === 'register' ? 'Cadastrando...' : 'Cadastrar'}
                </button>
              </form>

              <form className="form-card" onSubmit={handleActivateSubmit}>
                <h3>Ativar conta</h3>
                <label className="field">
                  <span>Celular usado no cadastro</span>
                  <input
                    value={activateForm.celular}
                    onChange={(event) => updateActivateField('celular', event.target.value)}
                    placeholder="+5511999999999"
                  />
                </label>
                <label className="field">
                  <span>Codigo recebido</span>
                  <input
                    value={activateForm.codigo}
                    onChange={(event) => updateActivateField('codigo', event.target.value)}
                    placeholder="1234"
                  />
                </label>
                <p className="helper-text">
                  Depois da ativacao, o front salva o JWT e o token do seller automaticamente.
                </p>

                <button className="primary-button" disabled={busyAction === 'activate'} type="submit">
                  {busyAction === 'activate' ? 'Ativando...' : 'Ativar conta'}
                </button>
              </form>

              <form className="form-card" onSubmit={handleLoginSubmit}>
                <h3>Entrar</h3>
                <label className="field">
                  <span>E-mail</span>
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(event) => updateLoginField('email', event.target.value)}
                    placeholder="mercado@email.com"
                  />
                </label>
                <label className="field">
                  <span>Senha</span>
                  <input
                    type="password"
                    value={loginForm.senha}
                    onChange={(event) => updateLoginField('senha', event.target.value)}
                    placeholder="Sua senha"
                  />
                </label>
                <button className="primary-button" disabled={busyAction === 'login'} type="submit">
                  {busyAction === 'login' ? 'Entrando...' : 'Fazer login'}
                </button>
              </form>
            </div>
          </article>
        </section>
        ) : null}
        {session.accessToken ? (
          <>
            <section className="content-grid">
              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Produtos</span>
                    <h2>{editingProductId ? 'Editar produto' : 'Cadastrar produto'}</h2>
                  </div>
                  {editingProductId ? (
                    <button className="ghost-button" type="button" onClick={resetProductEditor}>
                      Cancelar edicao
                    </button>
                  ) : null}
                </div>

                <form className="form-grid" onSubmit={handleProductSubmit}>
                  <label className="field field-span-2">
                    <span>Nome do produto</span>
                    <input
                      value={productForm.nome}
                      onChange={(event) => updateProductField('nome', event.target.value)}
                      placeholder="Arroz tipo 1"
                    />
                  </label>
                  <label className="field">
                    <span>Preco</span>
                    <input
                      min="0"
                      step="0.01"
                      type="number"
                      value={productForm.preco}
                      onChange={(event) => updateProductField('preco', event.target.value)}
                      placeholder="10.50"
                    />
                  </label>
                  <label className="field">
                    <span>Quantidade</span>
                    <input
                      min="0"
                      step="1"
                      type="number"
                      value={productForm.quantidade}
                      onChange={(event) => updateProductField('quantidade', event.target.value)}
                      placeholder="100"
                    />
                  </label>
                  <label className="field">
                    <span>Status</span>
                    <select
                      value={productForm.status}
                      onChange={(event) => updateProductField('status', event.target.value)}
                    >
                      <option value="Ativo">Ativo</option>
                      <option value="Inativo">Inativo</option>
                    </select>
                  </label>
                  <div className="field field-span-2">
                    <span>Imagem do produto</span>
                    {productForm.imagem ? (
                      <div className="image-picker-preview">
                        {productForm.imagem.startsWith('data:application/pdf') ? (
                          <span className="image-preview-pdf">PDF selecionado</span>
                        ) : (
                          <img className="image-preview-thumb" src={productForm.imagem} alt="Preview" />
                        )}
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => {
                            updateProductField('imagem', '');
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                        >
                          Remover
                        </button>
                      </div>
                    ) : null}
                    <label className="image-picker-label">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.pdf"
                        className="image-picker-input"
                        onChange={handleImageFileChange}
                      />
                      Selecionar imagem
                    </label>
                    <p className="helper-text">PNG, JPG, JPEG ou PDF — maximo 10 MB.</p>
                  </div>

                  <button className="primary-button field-span-2" disabled={busyAction === 'product'} type="submit">
                    {busyAction === 'product'
                      ? 'Salvando produto...'
                      : editingProductId
                        ? 'Atualizar produto'
                        : 'Cadastrar produto'}
                  </button>
                </form>
              </article>

              <article className="panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-kicker">Vendas</span>
                    <h2>Registrar venda</h2>
                  </div>
                </div>

                <form className="sale-form" onSubmit={handleSaleSubmit}>
                  <label className="field">
                    <span>Produto</span>
                    <select
                      value={saleForm.produtoId}
                      onChange={(event) => updateSaleField('produtoId', event.target.value)}
                    >
                      <option value="">Selecione um produto</option>
                      {products
                        .filter((product) => product.status === 'Ativo' && product.quantidade > 0)
                        .map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.nome} - {product.quantidade} un.
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Quantidade vendida</span>
                    <input
                      min="1"
                      step="1"
                      type="number"
                      value={saleForm.quantidade}
                      onChange={(event) => updateSaleField('quantidade', event.target.value)}
                    />
                  </label>

                  <button className="primary-button" disabled={busyAction === 'sale'} type="submit">
                    {busyAction === 'sale' ? 'Registrando venda...' : 'Confirmar venda'}
                  </button>
                </form>

                <p className="helper-text">
                  A lista de produtos da venda mostra apenas itens ativos com estoque disponivel.
                </p>
              </article>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <span className="panel-kicker">Catalogo</span>
                  <h2>Produtos cadastrados</h2>
                </div>
                <div className="catalog-actions">
                  <input
                    className="search-input"
                    placeholder="Buscar por nome, status ou ID"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                  />
                  <button className="ghost-button" type="button" onClick={loadProducts}>
                    Atualizar lista
                  </button>
                </div>
              </div>

              {productsLoading || isPending ? (
                <div className="empty-state">Sincronizando produtos com a API...</div>
              ) : filteredProducts.length ? (
                <div className="catalog-grid">
                  {filteredProducts.map((product) => (
                    <article className="product-card" key={product.id}>
                      <div className="product-media">
                        {product.imagem ? (
                          <img alt={product.nome} src={product.imagem} />
                        ) : (
                          <div className="product-placeholder">{product.nome.slice(0, 2).toUpperCase()}</div>
                        )}
                      </div>

                      <div className="product-content">
                        <div className="product-header">
                          <div>
                            <span className="product-id">Produto #{product.id}</span>
                            <h3>{product.nome}</h3>
                          </div>
                          <span className={`badge badge-${product.status.toLowerCase()}`}>
                            {product.status}
                          </span>
                        </div>

                        <div className="product-meta">
                          <span>{formatCurrency(product.preco)}</span>
                          <span>{product.quantidade} un. em estoque</span>
                        </div>

                        <div className="product-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => handleEditProduct(product)}
                          >
                            Editar
                          </button>
                          <button
                            className="danger-button"
                            disabled={busyAction === `inactivate-${product.id}` || product.status === 'Inativo'}
                            type="button"
                            onClick={() => handleInactivateProduct(product.id)}
                          >
                            {busyAction === `inactivate-${product.id}` ? 'Inativando...' : 'Inativar'}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">Nenhum produto encontrado para o filtro atual.</div>
              )}
            </section>

            <section className="panel" style={{ marginTop: '1.25rem' }}>
              <div className="panel-heading">
                <div>
                  <span className="panel-kicker">Historico</span>
                  <h2>Minhas vendas</h2>
                </div>
                <button className="ghost-button" type="button" onClick={loadSales}>
                  Atualizar lista
                </button>
              </div>

              {salesLoading ? (
                <div className="empty-state">Carregando vendas...</div>
              ) : sales.length ? (
                <div className="sales-list">
                  {sales.map((sale) => {
                    const product = sale.produto || {};
                    const imagem = product.imagem || sale.produto_imagem || '';
                    const nome = product.nome || sale.produto_nome || `Produto #${sale.produto_id || sale.produtoId || ''}`;
                    const quantidade = sale.quantidade;
                    const valorTotal = sale.valor_total ?? sale.valorTotal;
                    const createdAt = sale.created_at || sale.createdAt;

                    return (
                      <div className="sale-row" key={sale.id}>
                        <div className="sale-media">
                          {imagem ? (
                            <img alt={nome} src={imagem} />
                          ) : (
                            <div className="sale-placeholder">{nome.slice(0, 2).toUpperCase()}</div>
                          )}
                        </div>
                        <div className="sale-info">
                          <span className="sale-product-name">{nome}</span>
                        </div>
                        <div className="sale-stats">
                          <span className="sale-qty">{quantidade} un.</span>
                          <span className="sale-value">{formatCurrency(valorTotal)}</span>
                        </div>
                        <div className="sale-time">
                          {createdAt ? formatDateTime(createdAt) : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">Nenhuma venda registrada ainda.</div>
              )}
            </section>
          </>
        ) : (
          <section className="panel empty-session">
            <span className="panel-kicker">Pronto para conectar</span>
            <h2>Ative ou faca login em um seller para gerenciar os produtos.</h2>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;