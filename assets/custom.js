document.addEventListener('DOMContentLoaded', function () {

  /* ================================
     DISCOUNT TIERS (ITEM BASED)
  ================================= */
  const discountTiers = [
    { items: 1, discount: 16 },
    { items: 2, discount: 26 },
    { items: 3, discount: 36 }
  ];

  /* ================================
     MONEY FORMAT
  ================================= */
  function formatMoney(amount) {
    if (typeof Shopify !== 'undefined' && Shopify.formatMoney) {
      return Shopify.formatMoney(Math.round(amount * 100));
    }
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: window.Shopify?.currency?.active || 'EUR'
    }).format(amount);
  }

  /* ================================
     HTML MARKUP
  ================================= */
  function renderProgressHTML() {
    return `
      <div class="cart-progress">
        <p class="cart-progress__text"></p>
        <div class="cart-progress__bar">
          <div class="cart-progress__fill"></div>
          ${discountTiers.map(t => `
            <div class="cart-progress__marker" data-items="${t.items}">
              <span>${t.discount}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function injectProgressBar() {
    document.querySelectorAll('#cart-progress-container').forEach(container => {
      if (!container.querySelector('.cart-progress')) {
        container.innerHTML = renderProgressHTML();
      }
    });
  }

  /* ================================
     HELPERS
  ================================= */
  function getItemCount(cart) {
    return cart.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  function getOriginalSubtotal(cart) {
    return cart.items.reduce(
      (sum, item) => sum + item.original_line_price,
      0
    ) / 100;
  }

  function getAverageItemPrice(cart) {
    const qty = getItemCount(cart);
    if (!qty) return 0;
    return getOriginalSubtotal(cart) / qty;
  }

  /* ================================
     UPDATE PROGRESS
  ================================= */
  function updateProgress(cart) {
    injectProgressBar();

    const wrappers = document.querySelectorAll('.cart-progress');
    if (!wrappers.length) return;

    const itemCount = getItemCount(cart);
    const originalSubtotal = getOriginalSubtotal(cart);
    const avgItemPrice = getAverageItemPrice(cart);

    wrappers.forEach(wrapper => {
      const text = wrapper.querySelector('.cart-progress__text');
      const fill = wrapper.querySelector('.cart-progress__fill');
      const markers = wrapper.querySelectorAll('.cart-progress__marker');

      /* ----- ACTIVE TIER ----- */
      let activeTierIndex =
        itemCount >= 3 ? 2 :
        itemCount === 2 ? 1 :
        itemCount === 1 ? 0 : -1;

      /* ----- FILL WIDTH ----- */
      const progressPercent =
        activeTierIndex >= 0
          ? ((activeTierIndex + 1) / discountTiers.length) * 100
          : 0;

      fill.style.width = `${progressPercent}%`;

      /* ----- MARKER STATES ----- */
      markers.forEach((marker, index) => {
        marker.classList.toggle('is-active', index === activeTierIndex);
        marker.classList.toggle('is-complete', index < activeTierIndex);
      });

      /* ----- MESSAGE ----- */
      if (itemCount >= 3) {
        text.innerHTML = `<strong>🎉 Congrats!</strong> You’ve unlocked <b>36%</b> discount`;
      } else if (itemCount > 0) {
        const nextTier = discountTiers[activeTierIndex + 1];
        const targetItems = nextTier.items;
        const targetAmount = avgItemPrice * targetItems;
        const remaining = Math.max(targetAmount - originalSubtotal, 0);

        text.innerHTML = `<strong>${formatMoney(remaining)} left</strong> to reach ${nextTier.discount}% discount`;
      } else {
        text.innerHTML = `Add items to unlock discounts`;
      }
    });
  }

  /* ================================
     FETCH CART
  ================================= */
  async function fetchAndUpdate() {
    try {
      const res = await fetch('/cart.js');
      const cart = await res.json();
      updateProgress(cart);
    } catch (e) {
      console.error('Cart fetch failed', e);
    }
  }

  /* ================================
     EVENTS
  ================================= */
  document.addEventListener('cart:change', e => updateProgress(e.detail.cart));
  document.addEventListener('cart:refresh', fetchAndUpdate);
  document.addEventListener('variant:add', fetchAndUpdate);

  /* ================================
     OBSERVE CART DRAWER
  ================================= */
  ['#cart-drawer', '.cart'].forEach(selector => {
    const target = document.querySelector(selector);
    if (!target) return;

    const observer = new MutationObserver(() => fetchAndUpdate());
    observer.observe(target, { childList: true, subtree: true });
  });

  /* ================================
     INIT
  ================================= */
  fetchAndUpdate();
});
