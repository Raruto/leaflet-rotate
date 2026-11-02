@3d-layer
Feature: glTF models
  Scenario: Configured glTF loading retains objects and loads external PBR assets
    Given a map with the standalone 3D module and no dependency import map
    Then configured models preserve external assets and can be detached and reattached

  Scenario: Native geometry and model decoding preserve holes and accessor layouts
    Given a map with the standalone 3D module and no dependency import map
    Then native triangulation and glTF decoding preserve geometry without library requests

  Scenario: Model layers own loading, transforms and attribution
    Given a map with the standalone 3D module and no dependency import map
    Then a configured 3D model loads with its transforms and attribution

  Scenario Outline: Model failures are reported without attaching broken geometry
    Given a map with the standalone 3D module and no dependency import map
    When I load a configured 3D model with "<failure>"
    Then 3D initialization emits "<message>" as an error
    And the failed model has no attached geometry

    Examples:
      | failure            | message                            |
      | HTTP error         | Unable to load model: HTTP 404     |
      | unsupported glTF   | Layer3D supports static triangle glTF models without required extensions |
      | truncated GLB      | Truncated GLB data                 |

  @eiffel @3d-example
  Scenario: Hovering and clicking the Eiffel Tower shows information without moving or pinning
    Given the Eiffel Tower example page is open
    When I hover and click the Eiffel Tower in the 3D example
    Then the tower information is shown without moving the map or pinning the tooltip

  @eiffel
  Scenario: The real Eiffel Tower model follows the map camera
    Given the Eiffel Tower example page is open
    When I visit and inspect the Eiffel Tower 3D model
    Then the tower is rendered at its geographic position through camera changes
