import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { scenarioTimeout, withScenarioBudget } from '../support/scenario-budget.js';

Then('scenario deadlines reject late work without preventing cleanup', async function () {
  const world = { scenarioStarted: performance.now() - scenarioTimeout - 1 };
  let called = false;
  const action = () => { called = true; return 42; };
  await assert.rejects(withScenarioBudget(action).call(world), /30-second budget/);
  assert.equal(called, false);
  assert.equal(await withScenarioBudget(action, { cleanup: true }).call(world), 42);
  assert.equal(await withScenarioBudget(action).call({}), 42, 'Global setup has its own timeout');
  world.scenarioStarted = performance.now();
  assert.equal(await withScenarioBudget(action).call(world), 42);
  await assert.rejects(withScenarioBudget(function () {
    this.scenarioStarted -= scenarioTimeout + 1;
  }).call(world), /30-second budget/, 'Synchronous work must also consume the budget');
  await assert.rejects(withScenarioBudget(action).call(world), /30-second budget/);
  world.scenarioStarted = performance.now() - scenarioTimeout + 20;
  await assert.rejects(withScenarioBudget(() => new Promise(() => {})).call(world), /30-second budget/);
});
