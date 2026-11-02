@3d-layer
Feature: Shared 3D scene
  Scenario: Layer-owned objects preserve math and scene ordering without engine classes
    Given a map with the standalone 3D module and no dependency import map
    Then layer-owned objects preserve values and visibility without engine classes

  Scenario: Automatic origins are assigned on first addition and stay fixed
    Given a map with the standalone 3D module and no dependency import map
    Then 3D layers without a location keep their first map origin

  Scenario: Independent layers share one renderer and transfer ownership without changing geographic origins
    Given a map with the standalone 3D module and no dependency import map
    When I add and remove independent 3D layers
    Then 3D groups retain their geographic origins and share resources only on the same map

  Scenario: Dependency loading errors are reported to the caller
    Given a map with the standalone 3D module and no dependency import map
    Then an unavailable WebGPU adapter emits an error without leaving a canvas

  @eiffel @3d-example
  Scenario Outline: Changing the background preserves the 3D scene
    Given the Eiffel Tower example page is open
    When I select the "<background>" background in the 3D example
    Then only the "<background>" background is active and the 3D scene is unchanged

    Examples:
      | background     |
      | Empty          |
      | Plan IGN       |
      | Orthophoto IGN |

  @eiffel @3d-example
  Scenario: The layer control owns the shared canvas and model attribution
    Given the Eiffel Tower example page is open
    When I disable and restore the 3D overlays through the layer control
    Then the 3D canvas and model attribution follow the enabled overlays
