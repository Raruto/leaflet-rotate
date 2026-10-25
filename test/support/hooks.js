import assert from 'node:assert/strict';
import { After, AfterAll, Before, BeforeAll, Given, setDefaultTimeout } from '@cucumber/cucumber';
import { chromium } from 'playwright';
import { startServer } from '../../build/server.js';

setDefaultTimeout(10000);

let server;
let browser;
let baseUrl;

BeforeAll(async () => {
  server = await startServer(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

AfterAll({ timeout: 30000 }, async () => {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

Before(async function () {
  this.baseUrl = baseUrl;
  this.context = await browser.newContext();
  await this.context.route(/.html$/, async route => {
    const response = await route.fetch();
    const body = (await response.text())
      .replace(/https:\/\/unpkg\.com\/leaflet-rotate@(.*?)\//g, '../')
      .replace(/leaflet-rotate@(.*?)\//g, '../');
    await route.fulfill({ response, body, headers: response.headers() });
  });
  this.page = await this.context.newPage();
});

After(async function () {
  await this.context.close();
});

Given('the example page is open', async function () {
  await this.page.goto(`${baseUrl}/examples/leaflet-rotate.html`);
  await this.page.waitForLoadState('domcontentloaded');
});
