@3d-layer
Feature: Reusable 3D layers
  Scenario Outline: Terrain deforms raster tiles and keeps buildings and the camera at their ground elevation
    Given a map with the standalone 3D module and no dependency import map
    Then terrain enabled "<order>" raster loading preserves imagery, elevations and removal

    Examples:
      | order  |
      | before |
      | after  |

  Scenario: Cancelled building downloads release their slots and reload on return
    Given a map with the standalone 3D module and no dependency import map
    Then cancelled building downloads recover without errors or stale meshes

  Scenario: Raster layers restore perspective after toggling and late attachment
    Given a map with the standalone 3D module and no dependency import map
    Then raster perspective follows pitch on late and reattached layers

  Scenario: Pitched raster surfaces and markers remain visible after camera changes and compass reset
    Given a map with the standalone 3D module and no dependency import map
    Then pitched raster surfaces draw loaded tiles after rapid camera changes

  Scenario: The Paris example prevents navigation outside its local archives
    Given the Eiffel Tower example page is open
    Then the Paris example keeps navigation inside the building archive

  Scenario: Raster zoom transitions advance only with shared WebGL frames
    Given a map with the standalone 3D module and no dependency import map
    Then raster zoom transitions stay paused between WebGL frames and resume on removal

  Scenario: PMTiles layer methods handle range archives without external libraries
    Given a map with the standalone 3D module and no dependency import map
    Then the native PMTiles methods handle directories, compression and failures

  Scenario: Building blocks cover the visible ground through camera changes
    Given a map with the standalone 3D module and no dependency import map
    Then building blocks cover pitched views and retain overlapping areas

  Scenario: Raster tile levels follow the first camera change after accumulated pans
    Given a map with the standalone 3D module and no dependency import map
    Then raster tiles remain aligned after panning before their first pitch change

  Scenario: Resetting a pitched view after animated zoom restores the ground camera
    Given a map with the standalone 3D module and no dependency import map
    Then pitched view resets preserve the ground perspective after accumulated pans

  Scenario: Configured glTF loading retains objects and loads external PBR assets
    Given a map with the standalone 3D module and no dependency import map
    Then configured models preserve external assets and can be detached and reattached

  Scenario: DOM tooltips stay inside the map and restore the previous cursor
    Given a map with the standalone 3D module and no dependency import map
    Then DOM tooltip content stays inside the map without interpreting text as HTML

  Scenario: Layer-owned objects preserve math and scene ordering without engine classes
    Given a map with the standalone 3D module and no dependency import map
    Then layer-owned objects preserve values and visibility without engine classes

  Scenario Outline: Invalid source blocks report errors without partial meshes
    Given a map with the standalone 3D module and no dependency import map
    Then a source block with "<invalid>" reports "<message>" without attaching a mesh

    Examples:
      | invalid            | message                     |
      | collection         | Invalid GeoJSON response    |
      | geometry           | Unsupported GeoJSON geometry |
      | coordinates        | Invalid GeoJSON coordinates |
      | empty polygon      | Empty GeoJSON polygon       |
      | short ring         | Invalid GeoJSON polygon ring |

  Scenario: Automatic origins are assigned on first addition and stay fixed
    Given a map with the standalone 3D module and no dependency import map
    Then 3D layers without a location keep their first map origin

  Scenario: Independent layers share one renderer and transfer ownership without changing geographic origins
    Given a map with the standalone 3D module and no dependency import map
    When I add and remove independent 3D layers
    Then 3D groups retain their geographic origins and share resources only on the same map

  Scenario: Dependency loading errors are reported to the caller
    Given a map with the standalone 3D module and no dependency import map
    Then an unavailable WebGL context emits an error without leaving a canvas

  Scenario: Native geometry and model decoding preserve holes and accessor layouts
    Given a map with the standalone 3D module and no dependency import map
    Then native triangulation and glTF decoding preserve geometry without library requests

  Scenario: PMTiles layers initialize their archives
    Given a map with the standalone 3D module and no dependency import map
    Then PMTiles layers own archive initialization and native zoom selection

  Scenario: Model layers own loading, transforms and attribution
    Given a map with the standalone 3D module and no dependency import map
    Then a configured 3D model loads with its transforms and attribution

  Scenario: Feature tooltips belong to their 3D layer and never pin on click
    Given a map with the standalone 3D module and no dependency import map
    Then a 3D layer creates and cleans up its own hover tooltip

  Scenario: Clicking a 3D object emits events without moving the map
    Given a map with the standalone 3D module and no dependency import map
    Then 3D click reports the picked object without changing the map view

  @paris-buildings
  Scenario: Building volumes render with holes, storey heights, and interaction
    Given the Paris buildings example is open with sample volumes
    Then the building volumes preserve courtyards and elevated floors
    When I move and toggle the Paris building volumes
    Then 3D coverage follows the viewport, releases distant volumes, and recovers from failures

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
  Scenario Outline: The example filters invalid building volumes and estimates valid heights
    Given the Eiffel Tower example page is open
    Then building style for <storeys> storeys, <floors> floors and ground <ground> is "<result>"

    Examples:
      | storeys | floors | ground | result |
      | 4       | 5      | 1      | 15/0   |
      | 4       | 2      | 0      | 15/9   |
      | 0       | 1      | 1      | 3/0    |
      | -1      | 1      | 1      | skip   |
      | 4       | 0      | 0      | skip   |
      | 4       | 6      | 0      | skip   |
      | 4       | 2      | 2      | skip   |

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