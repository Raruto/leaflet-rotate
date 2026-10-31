@3d-layer
Feature: Reusable 3D layers
  Scenario: Automatic origins are assigned on first addition and stay fixed
    Given a map with the standalone 3D module and no dependency import map
    Then 3D layers without a location keep their first map origin

  Scenario: Independent layers load dependencies lazily and share one renderer per map
    Given a map with the standalone 3D module and no dependency import map
    When I add and remove independent 3D layers
    Then 3D groups retain their geographic origins and share resources only on the same map

  Scenario: Dependency loading errors are reported to the caller
    Given a map with the standalone 3D module and no dependency import map
    Then a failed three.js import rejects readiness and emits an error without leaving a canvas

  Scenario: PMTiles layers initialize their archives
    Given a map with the standalone 3D module and no dependency import map
    Then PMTiles layers own archive initialization and native zoom selection

  Scenario: Model layers own loading, transforms and attribution
    Given a map with the standalone 3D module and no dependency import map
    Then a configured 3D model loads with its transforms and attribution

  Scenario: Feature tooltips belong to their 3D layer and never pin on click
    Given a map with the standalone 3D module and no dependency import map
    Then a 3D layer creates and cleans up its own hover tooltip

  @paris-buildings
  Scenario: Building volumes render with holes, storey heights, and interaction
    Given the Paris buildings example is open with sample volumes
    Then the building volumes preserve courtyards and elevated floors
    When I move and toggle the Paris building volumes
    Then 3D neighbourhoods stay bounded, release distant volumes, and recover from failures