import { wrapPromiseWithTimeout } from '@cucumber/cucumber';

export const scenarioTimeout = 30000;

export function withScenarioBudget(code, options) {
  if (options?.cleanup) return code;
  return async function (...args) {
    if (this.scenarioStarted === undefined) return code.apply(this, args);
    const remaining = scenarioTimeout - (performance.now() - this.scenarioStarted);
    const message = 'Scenario exceeded its 30-second budget; split independent checks into separate scenarios';
    if (remaining <= 0) throw new Error(message);
    const result = await wrapPromiseWithTimeout(
      Promise.resolve().then(() => code.apply(this, args)), Math.ceil(remaining), message
    );
    if (performance.now() - this.scenarioStarted > scenarioTimeout) throw new Error(message);
    return result;
  };
}
