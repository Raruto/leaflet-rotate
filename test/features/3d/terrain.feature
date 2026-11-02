@3d-layer
Feature: Terrain and raster imagery
  Scenario: Building roofs use geographically aligned raster imagery and retain styled walls
    Given a map with the standalone 3D module and no dependency import map
    Then roof imagery follows raster loading, background changes and renderer ownership

  Scenario Outline: Terrain deforms raster tiles and keeps buildings and the camera at their ground elevation
    Given a map with the standalone 3D module and no dependency import map
    Then terrain enabled "<order>" raster loading preserves imagery, elevations and removal

    Examples:
      | order  |
      | before |
      | after  |

  Scenario: Raster layers restore perspective after toggling and late attachment
    Given a map with the standalone 3D module and no dependency import map
    Then raster perspective follows pitch on late and reattached layers

  Scenario: Pitched raster surfaces and markers remain visible after camera changes and compass reset
    Given a map with the standalone 3D module and no dependency import map
    Then pitched raster surfaces draw loaded tiles after rapid camera changes

  Scenario: Raster zoom transitions advance only with shared WebGPU frames
    Given a map with the standalone 3D module and no dependency import map
    Then raster zoom transitions stay paused between WebGPU frames and resume on removal

  Scenario: Raster tile levels follow the first camera change after accumulated pans
    Given a map with the standalone 3D module and no dependency import map
    Then raster tiles remain aligned after panning before their first pitch change

  Scenario: Resetting a pitched view after animated zoom restores the ground camera
    Given a map with the standalone 3D module and no dependency import map
    Then pitched view resets preserve the ground perspective after accumulated pans
