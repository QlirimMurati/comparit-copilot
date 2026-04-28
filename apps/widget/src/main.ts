import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideExperimentalZonelessChangeDetection } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { createCustomElement } from '@angular/elements';
import { WidgetComponent } from '@comparit-copilot/widget';

// Zoneless change detection — the widget runs entirely on signals + OnPush, and
// embedding into other Angular apps (comparer-ui) means we can't safely ship a
// second Zone.js instance into a host that already has one. Skipping zone.js
// also keeps the bundle smaller.
(async () => {
  try {
    const app = await createApplication({
      providers: [
        provideExperimentalZonelessChangeDetection(),
        provideHttpClient(withFetch()),
      ],
    });
    const element = createCustomElement(WidgetComponent, {
      injector: app.injector,
    });
    if (!customElements.get('copilot-widget')) {
      customElements.define('copilot-widget', element);
    }
    console.debug('[copilot-widget] custom element registered');
  } catch (err) {
    console.error('[copilot-widget] failed to register', err);
  }
})();
