/*
 * Cart drawer enhancements: quantity stepper, remove button, in-cart size (variant) switch, upsell carousel and
 * Shopify product recommendations. Quantity changes reuse the theme's <line-item-quantity>, adds reuse the theme's
 * product-form, so the drawer re-renders through the theme's own "cart:change" flow.
 */
(() => {
  if (window.__cartDrawerCustomLoaded) {
    return;
  }
  window.__cartDrawerCustomLoaded = true;

  const routesRoot = () => window.Shopify?.routes?.root || '/';
  const QUANTITY_DEBOUNCE = 400;

  const getBundledSections = () => {
    const sections = [];
    document.documentElement.dispatchEvent(new CustomEvent('cart:prepare-bundled-sections', { bubbles: true, detail: { sections } }));
    return sections;
  };

  const showLineError = (lineItem, message) => {
    const info = lineItem?.querySelector('.line-item__info');
    if (!info) {
      return;
    }
    info.querySelector('.cd-line__error')?.remove();
    const error = document.createElement('p');
    error.className = 'cd-line__error';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    info.appendChild(error);
  };

  /* ----------------------------------------------------------------------------------------------------------------
   * Quantity stepper and remove
   * -------------------------------------------------------------------------------------------------------------- */
  const updateStepperState = (input) => {
    const wrapper = input.closest('.cd-qty');
    const value = parseInt(input.value) || 0;
    const min = parseInt(input.min) || 1;
    const max = input.max ? parseInt(input.max) : Infinity;
    wrapper?.querySelector('[data-cd-qty-step="-1"]')?.toggleAttribute('disabled', value <= min);
    wrapper?.querySelector('[data-cd-qty-step="1"]')?.toggleAttribute('disabled', value >= max);
  };

  const commitQuantity = (input) => {
    clearTimeout(input._cdTimer);
    if (String(input.value) === String(input.defaultValue)) {
      return;
    }
    // The theme's <line-item-quantity> listens to this bubbling event and calls /cart/change.js
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  document.addEventListener('click', (event) => {
    const stepButton = event.target.closest('[data-cd-qty-step]');

    if (stepButton) {
      const input = stepButton.closest('.cd-qty')?.querySelector('.cd-qty__input');
      if (!input) {
        return;
      }

      const step = parseInt(input.step) || 1;
      const min = parseInt(input.min) || 1;
      const max = input.max ? parseInt(input.max) : Infinity;
      const next = Math.min(max, Math.max(min, (parseInt(input.value) || min) + step * parseInt(stepButton.dataset.cdQtyStep)));

      input.value = next;
      updateStepperState(input);
      clearTimeout(input._cdTimer);
      input._cdTimer = setTimeout(() => commitQuantity(input), QUANTITY_DEBOUNCE);
      return;
    }

    const removeButton = event.target.closest('[data-cd-remove]');

    if (removeButton) {
      const input = removeButton.closest('line-item')?.querySelector('.cd-qty__input');
      if (!input) {
        return;
      }

      removeButton.disabled = true;
      clearTimeout(input._cdTimer);
      input.value = 0;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  // Sanitize typed quantities before the theme reads them (capture phase runs before the theme's listener)
  document.addEventListener('change', (event) => {
    const input = event.target;
    if (!input.classList?.contains('cd-qty__input') || !event.isTrusted) {
      return;
    }

    const min = parseInt(input.min) || 1;
    const max = input.max ? parseInt(input.max) : Infinity;
    let value = parseInt(input.value);

    if (isNaN(value)) {
      value = parseInt(input.defaultValue) || min;
    }

    input.value = value === 0 ? 0 : Math.min(max, Math.max(min, value));
    clearTimeout(input._cdTimer);
    updateStepperState(input);

    if (String(input.value) === String(input.defaultValue)) {
      event.stopImmediatePropagation();
    }
  }, true);

  /* ----------------------------------------------------------------------------------------------------------------
   * Size dropdown: swap the variant of a line directly in the cart
   * -------------------------------------------------------------------------------------------------------------- */
  const swapVariant = async (select) => {
    const lineItem = select.closest('line-item');
    const newVariantId = parseInt(select.value);
    const currentVariantId = select.dataset.currentVariant;

    if (!newVariantId || String(newVariantId) === currentVariantId) {
      return;
    }

    let properties = {};
    try {
      properties = JSON.parse(select.dataset.properties || '{}') || {};
      // Liquid renders empty line item properties as [] but the Cart API expects an object
      if (Array.isArray(properties) || typeof properties !== 'object') {
        properties = {};
      }
    } catch (error) {
      properties = {};
    }

    const quantity = parseInt(select.dataset.quantity) || 1;
    const buildItem = (id) => {
      const item = { id: parseInt(id), quantity, properties };
      if (select.dataset.sellingPlan) {
        item.selling_plan = parseInt(select.dataset.sellingPlan);
      }
      return item;
    };

    const postJson = (url, body) => fetch(`${routesRoot()}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(body)
    });

    const readError = async (response, fallback) => {
      const json = await response.json().catch(() => ({}));
      return json.description || json.message || fallback;
    };

    select.disabled = true;
    lineItem?.dispatchEvent(new CustomEvent('line-item:will-change', { bubbles: true }));

    try {
      // 1. Remove the current size first. Line keys can change as soon as the cart changes (e.g. when the bundle
      //    discount kicks in), so the key is only reliable before any other cart operation.
      const removeResponse = await postJson('cart/change.js', { id: select.dataset.lineKey, quantity: 0 });

      if (!removeResponse.ok) {
        throw new Error(await readError(removeResponse, 'This size could not be changed.'));
      }

      // 2. Add the new size. If it fails (e.g. sold out), put the previous size back so nothing is lost.
      const sections = getBundledSections();
      let errorMessage = null;
      let addResponse = await postJson('cart/add.js', { items: [buildItem(newVariantId)], sections });

      if (!addResponse.ok) {
        errorMessage = await readError(addResponse, 'This size could not be added.');
        addResponse = await postJson('cart/add.js', { items: [buildItem(currentVariantId)], sections });
      }

      const addJson = addResponse.ok ? await addResponse.json() : {};

      if (window.themeVariables?.settings?.pageType === 'cart') {
        window.location.reload();
        return;
      }

      const cart = await (await fetch(`${routesRoot()}cart.js`)).json();
      cart.sections = addJson.sections;

      if (cart.sections) {
        document.documentElement.dispatchEvent(new CustomEvent('cart:change', {
          bubbles: true,
          detail: { baseEvent: 'variant:add', cart }
        }));
      } else {
        document.dispatchEvent(new CustomEvent('cart:refresh'));
      }

      if (errorMessage) {
        // The drawer re-renders right away; show the message on the restored line afterwards
        setTimeout(() => {
          const restoredSelect = document.querySelector(`#cart-drawer [data-cd-variant-select][data-current-variant="${currentVariantId}"]`);
          showLineError(restoredSelect?.closest('line-item'), errorMessage);
        }, 100);
      }
    } catch (error) {
      select.value = currentVariantId;
      select.disabled = false;
      lineItem?.dispatchEvent(new CustomEvent('line-item:error', { bubbles: true }));
      showLineError(lineItem, error.message);
    }
  };

  document.addEventListener('change', (event) => {
    if (event.target.matches?.('[data-cd-variant-select]')) {
      swapVariant(event.target);
    }
  });

  /* ----------------------------------------------------------------------------------------------------------------
   * Upsell errors (e.g. sold out) shown on the card
   * -------------------------------------------------------------------------------------------------------------- */
  document.addEventListener('cart:error', (event) => {
    const card = event.target.closest?.('.cd-upsell__card');
    const errorElement = card?.querySelector('.cd-upsell__error');
    if (!errorElement) {
      return;
    }
    errorElement.textContent = event.detail?.error || '';
    errorElement.hidden = !errorElement.textContent;
  });

  /* ----------------------------------------------------------------------------------------------------------------
   * Upsell carousel
   * -------------------------------------------------------------------------------------------------------------- */
  class CartDrawerCarousel extends HTMLElement {
    connectedCallback() {
      this._onScroll = () => {
        cancelAnimationFrame(this._frame);
        this._frame = requestAnimationFrame(() => this.updateButtons());
      };
      this._onClick = (event) => {
        const button = event.target.closest(`[aria-controls="${this.id}"]`);
        if (!button) {
          return;
        }
        const direction = button.hasAttribute('data-cd-carousel-next') ? 1 : -1;
        const rtl = getComputedStyle(this).direction === 'rtl' ? -1 : 1;
        this.scrollBy({ left: direction * rtl * this.clientWidth * 0.9, behavior: 'smooth' });
      };

      this.addEventListener('scroll', this._onScroll, { passive: true });
      this._container = this.closest('.cd-upsell');
      this._container?.addEventListener('click', this._onClick);
      this._resizeObserver = new ResizeObserver(this._onScroll);
      this._resizeObserver.observe(this);
      this.updateButtons();
    }

    disconnectedCallback() {
      this.removeEventListener('scroll', this._onScroll);
      this._container?.removeEventListener('click', this._onClick);
      this._resizeObserver?.disconnect();
    }

    updateButtons() {
      if (!this._container) {
        return;
      }
      const scrollLeft = Math.abs(this.scrollLeft);
      const maxScroll = this.scrollWidth - this.clientWidth;
      const prev = this._container.querySelector('[data-cd-carousel-prev]');
      const next = this._container.querySelector('[data-cd-carousel-next]');

      if (prev) prev.disabled = scrollLeft <= 2;
      if (next) next.disabled = scrollLeft >= maxScroll - 2;
      this._container.classList.toggle('cd-upsell--scrollable', maxScroll > 2);
    }
  }

  if (!window.customElements.get('cart-drawer-carousel')) {
    window.customElements.define('cart-drawer-carousel', CartDrawerCarousel);
  }

  /* ----------------------------------------------------------------------------------------------------------------
   * Shopify product recommendations (fetched once per product, then cached for the session)
   * -------------------------------------------------------------------------------------------------------------- */
  const recommendationsCache = new Map();

  class CartDrawerRecommendations extends HTMLElement {
    async connectedCallback() {
      const productId = this.getAttribute('product-id');
      const sectionId = this.getAttribute('section-id');

      if (!productId || !sectionId) {
        return this.hideUpsell();
      }

      const url = `${routesRoot()}recommendations/products?product_id=${encodeURIComponent(productId)}&limit=${encodeURIComponent(this.getAttribute('limit') || 6)}&intent=${encodeURIComponent(this.getAttribute('intent') || 'related')}&section_id=${encodeURIComponent(sectionId)}`;

      if (!recommendationsCache.has(url)) {
        recommendationsCache.set(url, fetch(url)
          .then((response) => (response.ok ? response.text() : ''))
          .then((text) => {
            const container = document.createElement('div');
            container.innerHTML = text;
            return container.querySelector('[data-cd-recs-result]')?.innerHTML || '';
          })
          .catch(() => ''));
      }

      const html = await recommendationsCache.get(url);

      if (!this.isConnected) {
        return;
      }

      const excluded = (this.getAttribute('exclude') || '').split(',');
      const container = document.createElement('div');
      container.innerHTML = html;
      container.querySelectorAll('[data-product-id]').forEach((card) => {
        if (excluded.includes(card.dataset.productId)) {
          card.remove();
        }
      });

      const cards = Array.from(container.querySelectorAll('.cd-upsell__card'));

      if (cards.length === 0) {
        return this.hideUpsell();
      }

      const carousel = this.closest('cart-drawer-carousel');
      this.replaceWith(...cards);
      carousel?.updateButtons?.();
    }

    hideUpsell() {
      const upsell = this.closest('.cd-upsell');
      if (upsell) {
        upsell.hidden = true;
      }
    }
  }

  if (!window.customElements.get('cart-drawer-recommendations')) {
    window.customElements.define('cart-drawer-recommendations', CartDrawerRecommendations);
  }
})();
