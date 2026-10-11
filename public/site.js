/* Public site interactions — no dependencies.
   Static build: no server calls. The newsletter form posts to whatever endpoint
   you configure in /write/ → Settings (src/data/settings.json), and falls back
   to a mailto: link to the author's inbox. */
(function () {
  'use strict';

  /* mobile nav */
  var toggle = document.querySelector('[data-nav-toggle]');
  var nav = document.querySelector('[data-nav]');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  /* newsletter signup */
  var form = document.querySelector('[data-subscribe-form]');
  if (form) {
    var note = form.querySelector('[data-subscribe-note]');
    form.addEventListener('submit', function (e) {
      var emailField = form.querySelector('input[name="email"]');
      var email = emailField ? emailField.value.trim() : '';
      var endpoint = form.getAttribute('data-endpoint') || '';
      var owner = form.getAttribute('data-email') || '';
      var btn = form.querySelector('button[type="submit"]');
      var note_ = note;

      function say(message, isError) {
        if (!note_) return;
        note_.textContent = message;
        note_.classList.toggle('is-error', !!isError);
      }

      if (!email) return;

      /* No endpoint configured: hand the address to the writer's inbox instead. */
      if (!endpoint) {
        e.preventDefault();
        if (!owner) { say('Set the newsletter email in /write/ → Settings.', true); return; }
        var subject = encodeURIComponent('Subscribe me to ' + document.title.split('—').pop().trim());
        var body = encodeURIComponent('Please add this address to the list:\n\n' + email + '\n');
        say('Opening your email app — send the message and you are on the list.');
        window.location.href = 'mailto:' + owner + '?subject=' + subject + '&body=' + body;
        return;
      }

      /* A form service (Buttondown, Formspree, Mailchimp…) is configured. */
      e.preventDefault();
      if (btn) { btn.disabled = true; btn.textContent = 'Subscribing…'; }
      say('', false);

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email }),
      })
        .then(function (res) {
          say(res.ok ? 'You are on the list. Talk soon.' : 'That did not work — try again in a moment.', !res.ok);
          if (res.ok) form.reset();
        })
        .catch(function () {
          say('Could not reach the server. Try again in a moment.', true);
        })
        .then(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Subscribe'; }
        });
    });
  }

  /* copy link on a post */
  var copyBtn = document.querySelector('[data-copy-link]');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var url = window.location.href;
      var done = function () {
        var old = copyBtn.innerHTML;
        copyBtn.innerHTML = 'Link copied';
        setTimeout(function () { copyBtn.innerHTML = old; }, 1600);
      };
      var fallback = function () {
        var t = document.createElement('textarea');
        t.value = url;
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.appendChild(t);
        t.select();
        try { document.execCommand('copy'); done(); } catch (err) { /* ignore */ }
        document.body.removeChild(t);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, fallback);
      } else {
        fallback();
      }
    });
  }

  /* blog search — a static site filters in the browser */
  var searchInput = document.querySelector('[data-search-input]');
  var grid = document.querySelector('[data-post-grid]');
  if (searchInput && grid) {
    var empty = document.querySelector('[data-empty-state]');
    var searchForm = document.querySelector('[data-search-form]');
    if (searchForm) searchForm.addEventListener('submit', function (e) { e.preventDefault(); });

    var cards = Array.prototype.slice.call(grid.querySelectorAll('[data-post-card]'));
    var index = cards.map(function (card) {
      return { card: card, text: (card.textContent || '').toLowerCase() };
    });

    var apply = function () {
      var needle = searchInput.value.trim().toLowerCase();
      var shown = 0;
      index.forEach(function (item) {
        var match = !needle || item.text.indexOf(needle) >= 0;
        item.card.hidden = !match;
        if (match) shown++;
      });
      if (empty) empty.hidden = shown !== 0 || !needle;
      if (window.history && window.history.replaceState) {
        var url = new URL(window.location.href);
        if (needle) url.searchParams.set('q', needle); else url.searchParams.delete('q');
        window.history.replaceState(null, '', url);
      }
    };

    /* a ?q= in the address bar still filters on arrival */
    var initial = new URL(window.location.href).searchParams.get('q');
    if (initial) searchInput.value = initial;
    if (initial) apply();

    var timer = null;
    searchInput.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(apply, 120);
    });
  }
})();
