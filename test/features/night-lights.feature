@3d-layer @night-lights
Feature: Indicative Paris night lighting
  Scenario: Real lamp inventory lights the ground at night and the Eiffel Tower glows
    Given the Eiffel Tower example page is open with its offline archives
    Then streetlights and the Eiffel Tower emit light only during simulated night
