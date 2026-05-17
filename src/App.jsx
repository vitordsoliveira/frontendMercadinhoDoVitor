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

const EMPTY_SALE_EDIT_FORM = {
  produtoId: '',
  quantidade: '1',
  precoUnitario: '',
};

const EMPTY_PROFILE_FORM = {
  nome: '',
  email: '',
  celular: '',
  senha: '',
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

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function formatFullDate(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
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
  const [activeSection, setActiveSection] = useState('dashboard');
  const [authStep, setAuthStep] = useState('login');
  const [editingSaleId, setEditingSaleId] = useState(null);
  const [saleEditForm, setSaleEditForm] = useState(EMPTY_SALE_EDIT_FORM);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [showProfileEditor, setShowProfileEditor] = useState(false);

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
        celular: data.seller?.celular || registerForm.celular || currentValue.celular,
      }));
      setLoginForm((currentValue) => ({
        ...currentValue,
        email: data.seller?.email || currentValue.email,
      }));
      showFeedback('success', data.message || 'Cadastro realizado! Verifique seu WhatsApp.');
      setAuthStep('activate');
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

  function updateSaleEditField(fieldName, value) {
    setSaleEditForm((currentValue) => ({ ...currentValue, [fieldName]: value }));
  }

  function updateProfileField(fieldName, value) {
    setProfileForm((currentValue) => ({ ...currentValue, [fieldName]: value }));
  }

  function resetSaleEditor() {
    setEditingSaleId(null);
    setSaleEditForm(EMPTY_SALE_EDIT_FORM);
  }

  async function handleActivateProduct(productId) {
    await runAction(`activate-product-${productId}`, async () => {
      const data = await mercadinhoApi.activateProduct(apiUrl, session.accessToken, productId);
      showFeedback('success', data.message || 'Produto reativado.');
      await loadProducts();
    });
  }

  function handleEditSale(sale) {
    setEditingSaleId(sale.id);
    setSaleEditForm({
      produtoId: String(sale.produto_id || sale.produtoId || sale.produto?.id || ''),
      quantidade: String(sale.quantidade),
      precoUnitario: String(sale.preco_unitario || sale.precoUnitario || ''),
    });
  }

  async function handleSaleEditSubmit(event, saleId) {
    event.preventDefault();

    await runAction(`sale-edit-${saleId}`, async () => {
      if (!saleEditForm.produtoId || saleEditForm.quantidade === '') {
        throw new Error('Informe o produto e a quantidade.');
      }

      const payload = {
        produtoId: Number(saleEditForm.produtoId),
        quantidade: Number(saleEditForm.quantidade),
      };

      if (saleEditForm.precoUnitario !== '') {
        payload.precoUnitario = Number(saleEditForm.precoUnitario);
      }

      const data = await mercadinhoApi.updateSale(apiUrl, session.accessToken, saleId, payload);
      showFeedback('success', data.message || 'Venda atualizada.');
      resetSaleEditor();
      await loadSales();
      await loadProducts();
    });
  }

  async function handleCancelSale(saleId) {
    await runAction(`cancel-sale-${saleId}`, async () => {
      const data = await mercadinhoApi.deleteSale(apiUrl, session.accessToken, saleId);
      showFeedback('success', data.message || 'Venda cancelada. Estoque restaurado.');
      await loadSales();
      await loadProducts();
    });
  }

  async function handleOpenProfileEditor() {
    setProfileForm({
      nome: session.seller?.nome || '',
      email: session.seller?.email || '',
      celular: session.seller?.celular || '',
      senha: '',
    });
    setShowProfileEditor(true);

    try {
      const data = await mercadinhoApi.getSellerProfile(apiUrl, session.accessToken);
      const seller = data.seller || data;
      setProfileForm({
        nome: seller.nome || session.seller?.nome || '',
        email: seller.email || session.seller?.email || '',
        celular: seller.celular || session.seller?.celular || '',
        senha: '',
      });
    } catch {
      // usa dados da sessao local
    }
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();

    await runAction('profile', async () => {
      if (!profileForm.nome.trim() || !profileForm.email.trim() || !profileForm.celular.trim()) {
        throw new Error('Preencha nome, e-mail e celular.');
      }

      const payload = {
        nome: profileForm.nome.trim(),
        email: profileForm.email.trim(),
        celular: profileForm.celular.trim(),
      };

      if (profileForm.senha.trim()) {
        payload.senha = profileForm.senha.trim();
      }

      const data = await mercadinhoApi.updateSellerProfile(apiUrl, session.accessToken, payload);
      showFeedback('success', data.message || 'Perfil atualizado com sucesso.');

      if (data.seller) {
        setSession((currentValue) => ({
          ...currentValue,
          seller: { ...currentValue.seller, ...data.seller },
        }));
      }

      setProfileForm((currentValue) => ({ ...currentValue, senha: '' }));
    });
  }

  function handleLogout() {
    setSession(EMPTY_SESSION);
    setProducts([]);
    setSales([]);
    setEditingProductId(null);
    setSaleForm(EMPTY_SALE_FORM);
    resetSaleEditor();
    setShowProfileEditor(false);
    setActiveSection('dashboard');
    setAuthStep('login');
    showFeedback('neutral', 'Sessao encerrada neste navegador.');
  }

  const dashTotalRevenue = sales.reduce(
    (sum, s) => sum + Number(s.valor_total ?? s.valorTotal ?? 0),
    0,
  );
  const dashTotalSales = sales.length;
  const dashActiveProducts = products.filter((p) => p.status === 'Ativo').length;
  const dashOutOfStock = products.filter((p) => p.quantidade === 0).length;
  const dashLowStock = products.filter((p) => p.quantidade > 0 && p.quantidade <= 10);
  const dashRecentSales = [...sales].reverse().slice(0, 5);
  const dashTopProducts = (() => {
    const map = {};
    sales.forEach((sale) => {
      const id = String(sale.produto_id || sale.produtoId || sale.produto?.id || '');
      const nome =
        sale.produto?.nome || sale.produto_nome || `Produto #${id}`;
      if (!map[id]) map[id] = { nome, value: 0, qty: 0 };
      map[id].value += Number(sale.valor_total ?? sale.valorTotal ?? 0);
      map[id].qty += Number(sale.quantidade);
    });
    return Object.values(map)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  })();
  const dashMaxRevenue = dashTopProducts[0]?.value || 1;

  const sectionTitles = { dashboard: 'Dashboard', products: 'Produtos', sales: 'Vendas', profile: 'Meu Perfil' };
  const sellerInitials = (session.seller?.nome || 'S').split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  return (
    <div className="page-shell">
      <div className="page-glow page-glow-left" />
      <div className="page-glow page-glow-right" />

      {session.accessToken ? (
        <div className="dashboard-layout">

          {/* ── SIDEBAR ── */}
          <aside className="app-sidebar">
            <div className="sidebar-brand">
              <span className="sidebar-logo">Mercadinho</span>
              <span className="sidebar-tagline">Gestao de vendas</span>
            </div>

            <nav className="sidebar-nav">
              {[
                { id: 'dashboard', icon: 'bi-speedometer2', label: 'Dashboard' },
                { id: 'products',  icon: 'bi-box-seam',     label: 'Produtos' },
                { id: 'sales',     icon: 'bi-cart3',        label: 'Vendas' },
                { id: 'profile',   icon: 'bi-person-circle', label: 'Meu Perfil' },
              ].map((item) => (
                <button
                  key={item.id}
                  className={`sidebar-item${activeSection === item.id ? ' sidebar-item-active' : ''}`}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                >
                  <i className={`bi ${item.icon} sidebar-item-icon`} />
                  <span className="sidebar-item-label">{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="sidebar-footer">
              <button className="sidebar-logout" type="button" onClick={handleLogout}>
                <i className="bi bi-box-arrow-left sidebar-item-icon" />
                <span className="sidebar-item-label">Sair</span>
              </button>
            </div>
          </aside>

          {/* ── MAIN AREA ── */}
          <div className="app-main">
            <header className="app-topbar">
              <h1 className="topbar-section-title">{sectionTitles[activeSection]}</h1>
              <div className="topbar-seller">
                <div className="seller-avatar">{sellerInitials}</div>
                <div className="seller-info">
                  <span className="seller-name">{session.seller?.nome}</span>
                  <span className="seller-email">{session.seller?.email}</span>
                </div>
              </div>
            </header>

            {feedback.text ? (
              <div className={`feedback-banner feedback-${feedback.tone} topbar-feedback`}>{feedback.text}</div>
            ) : null}

            <main className="app-content">

              {/* ── DASHBOARD ── */}
              {activeSection === 'dashboard' && (
                <div className="dashboard">
                  <div className="dashboard-greeting">
                    <div>
                      <span className="panel-kicker">Visao geral</span>
                      <h2 className="dashboard-title">
                        {getGreeting()}, {session.seller?.nome?.split(' ')[0] || 'Seller'}!
                      </h2>
                      <p className="dashboard-date">{formatFullDate(new Date())}</p>
                    </div>
                  </div>

                  <div className="dashboard-stats">
                    <div className="stat-card stat-green">
                      <div className="stat-body">
                        <span className="stat-value">{dashTotalSales}</span>
                        <span className="stat-label">Vendas realizadas</span>
                      </div>
                    </div>
                    <div className="stat-card stat-orange">
                      <div className="stat-body">
                        <span className="stat-value stat-value-md">{formatCurrency(dashTotalRevenue)}</span>
                        <span className="stat-label">Faturamento total</span>
                      </div>
                    </div>
                    <div className="stat-card stat-teal">
                      <div className="stat-body">
                        <span className="stat-value">{dashActiveProducts}</span>
                        <span className="stat-label">Produtos ativos</span>
                      </div>
                    </div>
                    <div className={`stat-card ${dashOutOfStock > 0 ? 'stat-danger' : 'stat-teal'}`}>
                      <div className="stat-body">
                        <span className="stat-value">{dashOutOfStock}</span>
                        <span className="stat-label">Sem estoque</span>
                      </div>
                    </div>
                  </div>

                  <div className="dashboard-grid">
                    <div className="dashboard-card">
                      <h3 className="dashboard-card-title">Estoque critico</h3>
                      {dashLowStock.length ? (
                        <div className="low-stock-list">
                          {dashLowStock.map((p) => (
                            <div className="low-stock-item" key={p.id}>
                              <span className="low-stock-name">{p.nome}</span>
                              <span className="low-stock-qty">{p.quantidade} un.</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="dashboard-empty">Todos os produtos estao com estoque ok.</p>
                      )}
                    </div>

                    <div className="dashboard-card">
                      <h3 className="dashboard-card-title">Ultimas vendas</h3>
                      {dashRecentSales.length ? (
                        <div className="recent-sales-list">
                          {dashRecentSales.map((sale) => {
                            const nome = sale.produto?.nome || sale.produto_nome || `Produto #${sale.produto_id || sale.produtoId || ''}`;
                            const valorTotal = sale.valor_total ?? sale.valorTotal;
                            const createdAt = sale.created_at || sale.createdAt;
                            return (
                              <div className="recent-sale-item" key={sale.id}>
                                <span className="recent-sale-name">{nome}</span>
                                <span className="recent-sale-qty">{sale.quantidade} un.</span>
                                <span className="recent-sale-value">{formatCurrency(valorTotal)}</span>
                                <span className="recent-sale-time">{createdAt ? formatDateTime(createdAt) : '—'}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="dashboard-empty">Nenhuma venda registrada ainda.</p>
                      )}
                    </div>
                  </div>

                  {dashTopProducts.length > 0 && (
                    <div className="dashboard-card">
                      <h3 className="dashboard-card-title">Top produtos por faturamento</h3>
                      <div className="bar-chart">
                        {dashTopProducts.map((p, i) => (
                          <div className="bar-row" key={i}>
                            <span className="bar-label">{p.nome}</span>
                            <div className="bar-track">
                              <div className="bar-fill" style={{ width: `${(p.value / dashMaxRevenue) * 100}%` }} />
                            </div>
                            <span className="bar-value">{formatCurrency(p.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── PRODUTOS ── */}
              {activeSection === 'products' && (
                <>
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
                        <input value={productForm.nome} onChange={(e) => updateProductField('nome', e.target.value)} placeholder="Arroz tipo 1" />
                      </label>
                      <label className="field">
                        <span>Preco</span>
                        <input min="0" step="0.01" type="number" value={productForm.preco} onChange={(e) => updateProductField('preco', e.target.value)} placeholder="10.50" />
                      </label>
                      <label className="field">
                        <span>Quantidade</span>
                        <input min="0" step="1" type="number" value={productForm.quantidade} onChange={(e) => updateProductField('quantidade', e.target.value)} placeholder="100" />
                      </label>
                      <label className="field">
                        <span>Status</span>
                        <select value={productForm.status} onChange={(e) => updateProductField('status', e.target.value)}>
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
                            <button className="ghost-button" type="button" onClick={() => { updateProductField('imagem', ''); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                              Remover
                            </button>
                          </div>
                        ) : null}
                        <label className="image-picker-label">
                          <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.pdf" className="image-picker-input" onChange={handleImageFileChange} />
                          Selecionar imagem
                        </label>
                        <p className="helper-text">PNG, JPG, JPEG ou PDF — maximo 10 MB.</p>
                      </div>
                      <button className="primary-button field-span-2" disabled={busyAction === 'product'} type="submit">
                        {busyAction === 'product' ? 'Salvando produto...' : editingProductId ? 'Atualizar produto' : 'Cadastrar produto'}
                      </button>
                    </form>
                  </article>

                  <section className="panel section-below">
                    <div className="panel-heading">
                      <div>
                        <span className="panel-kicker">Catalogo</span>
                        <h2>Produtos cadastrados</h2>
                      </div>
                      <div className="catalog-actions">
                        <input className="search-input" placeholder="Buscar por nome, status ou ID" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        <button className="ghost-button" type="button" onClick={loadProducts}>Atualizar lista</button>
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
                                <span className={`badge badge-${product.status.toLowerCase()}`}>{product.status}</span>
                              </div>
                              <div className="product-meta">
                                <span>{formatCurrency(product.preco)}</span>
                                <span>{product.quantidade} un. em estoque</span>
                              </div>
                              <div className="product-actions">
                                <button className="secondary-button" type="button" onClick={() => handleEditProduct(product)}>Editar</button>
                                {product.status === 'Inativo' ? (
                                  <button className="reactivate-button" disabled={busyAction === `activate-product-${product.id}`} type="button" onClick={() => handleActivateProduct(product.id)}>
                                    {busyAction === `activate-product-${product.id}` ? 'Reativando...' : 'Reativar'}
                                  </button>
                                ) : (
                                  <button className="danger-button" disabled={busyAction === `inactivate-${product.id}`} type="button" onClick={() => handleInactivateProduct(product.id)}>
                                    {busyAction === `inactivate-${product.id}` ? 'Inativando...' : 'Inativar'}
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">Nenhum produto encontrado para o filtro atual.</div>
                    )}
                  </section>
                </>
              )}

              {/* ── VENDAS ── */}
              {activeSection === 'sales' && (
                <>
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
                        <select value={saleForm.produtoId} onChange={(e) => updateSaleField('produtoId', e.target.value)}>
                          <option value="">Selecione um produto</option>
                          {products.filter((p) => p.status === 'Ativo' && p.quantidade > 0).map((p) => (
                            <option key={p.id} value={p.id}>{p.nome} - {p.quantidade} un.</option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Quantidade vendida</span>
                        <input min="1" step="1" type="number" value={saleForm.quantidade} onChange={(e) => updateSaleField('quantidade', e.target.value)} />
                      </label>
                      <button className="primary-button" disabled={busyAction === 'sale'} type="submit">
                        {busyAction === 'sale' ? 'Registrando venda...' : 'Confirmar venda'}
                      </button>
                    </form>
                    <p className="helper-text">A lista mostra apenas itens ativos com estoque disponivel.</p>
                  </article>

                  <section className="panel section-below">
                    <div className="panel-heading">
                      <div>
                        <span className="panel-kicker">Historico</span>
                        <h2>Minhas vendas</h2>
                      </div>
                      <button className="ghost-button" type="button" onClick={loadSales}>Atualizar lista</button>
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
                          const isEditing = editingSaleId === sale.id;

                          if (isEditing) {
                            return (
                              <div className="sale-row sale-edit-row" key={sale.id}>
                                <div className="sale-media">
                                  {imagem ? <img alt={nome} src={imagem} /> : <div className="sale-placeholder">{nome.slice(0, 2).toUpperCase()}</div>}
                                </div>
                                <form className="sale-edit-form" onSubmit={(e) => handleSaleEditSubmit(e, sale.id)}>
                                  <span className="sale-edit-title">Editando venda #{sale.id}</span>
                                  <div className="sale-edit-fields">
                                    <label className="field">
                                      <span>Produto</span>
                                      <select value={saleEditForm.produtoId} onChange={(e) => updateSaleEditField('produtoId', e.target.value)}>
                                        {products.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                                      </select>
                                    </label>
                                    <label className="field">
                                      <span>Quantidade</span>
                                      <input min="1" step="1" type="number" value={saleEditForm.quantidade} onChange={(e) => updateSaleEditField('quantidade', e.target.value)} />
                                    </label>
                                    <label className="field">
                                      <span>Preco unitario</span>
                                      <input min="0" step="0.01" type="number" value={saleEditForm.precoUnitario} onChange={(e) => updateSaleEditField('precoUnitario', e.target.value)} placeholder="Opcional" />
                                    </label>
                                  </div>
                                  <div className="sale-edit-actions">
                                    <button className="primary-button" disabled={busyAction === `sale-edit-${sale.id}`} type="submit">
                                      {busyAction === `sale-edit-${sale.id}` ? 'Salvando...' : 'Salvar'}
                                    </button>
                                    <button className="ghost-button" type="button" onClick={resetSaleEditor}>Cancelar</button>
                                  </div>
                                </form>
                              </div>
                            );
                          }

                          return (
                            <div className="sale-row" key={sale.id}>
                              <div className="sale-media">
                                {imagem ? <img alt={nome} src={imagem} /> : <div className="sale-placeholder">{nome.slice(0, 2).toUpperCase()}</div>}
                              </div>
                              <div className="sale-info"><span className="sale-product-name">{nome}</span></div>
                              <div className="sale-stats">
                                <span className="sale-qty">{quantidade} un.</span>
                                <span className="sale-value">{formatCurrency(valorTotal)}</span>
                              </div>
                              <div className="sale-time">{createdAt ? formatDateTime(createdAt) : '—'}</div>
                              <div className="sale-actions">
                                <button className="secondary-button" type="button" onClick={() => handleEditSale(sale)}>Editar</button>
                                <button className="danger-button" disabled={busyAction === `cancel-sale-${sale.id}`} type="button" onClick={() => handleCancelSale(sale.id)}>
                                  {busyAction === `cancel-sale-${sale.id}` ? 'Cancelando...' : 'Cancelar'}
                                </button>
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
              )}

              {/* ── PERFIL ── */}
              {activeSection === 'profile' && (
                <section className="panel profile-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="panel-kicker">Minha Conta</span>
                      <h2>Perfil do Seller</h2>
                    </div>
                    <button className="ghost-button" type="button" onClick={showProfileEditor ? () => setShowProfileEditor(false) : handleOpenProfileEditor}>
                      {showProfileEditor ? 'Fechar' : 'Editar perfil'}
                    </button>
                  </div>

                  <div className="profile-info-grid">
                    <div className="profile-info-item">
                      <span className="profile-info-label">Nome</span>
                      <strong>{session.seller?.nome || '—'}</strong>
                    </div>
                    <div className="profile-info-item">
                      <span className="profile-info-label">E-mail</span>
                      <strong>{session.seller?.email || '—'}</strong>
                    </div>
                    <div className="profile-info-item">
                      <span className="profile-info-label">Celular</span>
                      <strong>{session.seller?.celular || '—'}</strong>
                    </div>
                    <div className="profile-info-item">
                      <span className="profile-info-label">CNPJ</span>
                      <strong>{session.seller?.cnpj || '—'}</strong>
                    </div>
                    <div className="profile-info-item">
                      <span className="profile-info-label">Status</span>
                      <span className={`badge badge-${(session.seller?.status || '').toLowerCase()}`}>{session.seller?.status || '—'}</span>
                    </div>
                  </div>

                  {showProfileEditor ? (
                    <form className="form-grid profile-form" onSubmit={handleProfileSubmit}>
                      <label className="field">
                        <span>Nome do mercado</span>
                        <input value={profileForm.nome} onChange={(e) => updateProfileField('nome', e.target.value)} placeholder="Mercadinho Central" />
                      </label>
                      <label className="field">
                        <span>E-mail</span>
                        <input type="email" value={profileForm.email} onChange={(e) => updateProfileField('email', e.target.value)} placeholder="mercado@email.com" />
                      </label>
                      <label className="field">
                        <span>Celular</span>
                        <input value={profileForm.celular} onChange={(e) => updateProfileField('celular', e.target.value)} placeholder="+5511999999999" />
                      </label>
                      <label className="field">
                        <span>Nova senha</span>
                        <input type="password" value={profileForm.senha} onChange={(e) => updateProfileField('senha', e.target.value)} placeholder="Deixe em branco para manter" />
                      </label>
                      <button className="primary-button field-span-2" disabled={busyAction === 'profile'} type="submit">
                        {busyAction === 'profile' ? 'Salvando perfil...' : 'Salvar alteracoes'}
                      </button>
                    </form>
                  ) : null}
                </section>
              )}

            </main>
          </div>
        </div>
      ) : (
        <main className="auth-page">
          <div className="auth-container">
            <div className="auth-logo">
              <i className="bi bi-cart3 auth-logo-icon" />
              <h1>Mercadinho</h1>
              <p>Gestao de vendas</p>
            </div>

            {feedback.text ? (
              <div className={`feedback-banner feedback-${feedback.tone}`}>{feedback.text}</div>
            ) : null}

            {authStep === 'login' && (
              <div className="auth-card">
                <h2>Entrar na sua conta</h2>
                <form onSubmit={handleLoginSubmit}>
                  <label className="field">
                    <span>E-mail</span>
                    <input
                      type="email"
                      value={loginForm.email}
                      onChange={(e) => updateLoginField('email', e.target.value)}
                      placeholder="mercado@email.com"
                      autoComplete="email"
                    />
                  </label>
                  <label className="field">
                    <span>Senha</span>
                    <input
                      type="password"
                      value={loginForm.senha}
                      onChange={(e) => updateLoginField('senha', e.target.value)}
                      placeholder="Sua senha"
                      autoComplete="current-password"
                    />
                  </label>
                  <button className="primary-button" disabled={busyAction === 'login'} type="submit">
                    {busyAction === 'login' ? 'Entrando...' : 'Entrar'}
                  </button>
                </form>
                <p className="auth-footer">
                  Nao tem conta?{' '}
                  <button className="auth-link" type="button" onClick={() => setAuthStep('register')}>
                    Criar conta
                  </button>
                </p>
              </div>
            )}

            {authStep === 'register' && (
              <div className="auth-card">
                <h2>Criar conta</h2>
                <form onSubmit={handleRegisterSubmit}>
                  <label className="field">
                    <span>Nome do mercado</span>
                    <input
                      value={registerForm.nome}
                      onChange={(e) => updateRegisterField('nome', e.target.value)}
                      placeholder="Mercadinho Central"
                    />
                  </label>
                  <label className="field">
                    <span>CNPJ</span>
                    <input
                      value={registerForm.cnpj}
                      onChange={(e) => updateRegisterField('cnpj', e.target.value)}
                      placeholder="12345678000199"
                    />
                  </label>
                  <label className="field">
                    <span>E-mail</span>
                    <input
                      type="email"
                      value={registerForm.email}
                      onChange={(e) => updateRegisterField('email', e.target.value)}
                      placeholder="mercado@email.com"
                    />
                  </label>
                  <label className="field">
                    <span>Celular (com DDD)</span>
                    <input
                      value={registerForm.celular}
                      onChange={(e) => updateRegisterField('celular', e.target.value)}
                      placeholder="11999999999"
                    />
                  </label>
                  <label className="field">
                    <span>Senha</span>
                    <input
                      type="password"
                      value={registerForm.senha}
                      onChange={(e) => updateRegisterField('senha', e.target.value)}
                      placeholder="Crie uma senha"
                      autoComplete="new-password"
                    />
                  </label>
                  <button className="primary-button" disabled={busyAction === 'register'} type="submit">
                    {busyAction === 'register' ? 'Cadastrando...' : 'Criar conta'}
                  </button>
                </form>
                <p className="auth-footer">
                  Ja tem conta?{' '}
                  <button className="auth-link" type="button" onClick={() => setAuthStep('login')}>
                    Entrar
                  </button>
                </p>
              </div>
            )}

            {authStep === 'activate' && (
              <div className="auth-card">
                <div className="auth-step-info">
                  <i className="bi bi-whatsapp" />
                  <span>Um codigo de ativacao foi enviado para o seu celular via WhatsApp. Insira abaixo para ativar sua conta.</span>
                </div>
                <h2>Ativar conta</h2>
                <form onSubmit={handleActivateSubmit}>
                  <label className="field">
                    <span>Celular usado no cadastro</span>
                    <input
                      value={activateForm.celular}
                      onChange={(e) => updateActivateField('celular', e.target.value)}
                      placeholder="+5511999999999"
                    />
                  </label>
                  <label className="field">
                    <span>Codigo recebido</span>
                    <input
                      value={activateForm.codigo}
                      onChange={(e) => updateActivateField('codigo', e.target.value)}
                      placeholder="1234"
                      autoComplete="one-time-code"
                    />
                  </label>
                  <button className="primary-button" disabled={busyAction === 'activate'} type="submit">
                    {busyAction === 'activate' ? 'Ativando...' : 'Ativar e entrar'}
                  </button>
                </form>
                <p className="auth-footer">
                  <button className="auth-link" type="button" onClick={() => setAuthStep('login')}>
                    <i className="bi bi-arrow-left" /> Voltar para o login
                  </button>
                </p>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}

export default App;