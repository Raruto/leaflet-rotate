@3d-layer
Feature: Picking and tooltips
  Scenario: DOM tooltips stay inside the map and restore the previous cursor
    Given a map with the standalone 3D module and no dependency import map
    Then DOM tooltip content stays inside the map without interpreting text as HTML

  Scenario: Feature tooltips belong to their 3D layer and never pin on click
    Given a map with the standalone 3D module and no dependency import map
    Then a 3D layer creates and cleans up its own hover tooltip

  Scenario: Clicking a 3D object emits events without moving the map
    Given a map with the standalone 3D module and no dependency import map
    Then 3D click reports the picked object without changing the map view
