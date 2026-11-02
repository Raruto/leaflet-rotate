@3d-layer
Feature: Shared WebGPU renderer
  @webgpu
  Scenario: Panning reuses WebGPU frame resources and keeps frustum culling
    Given the Eiffel Tower example page is open
    When I pan the shared WebGPU renderer
    Then WebGPU matrices match DOMMatrix and frame resources are reused

  @webgpu
  Scenario: Map events render once per tick and upload uniforms once per frame
    Given the Eiffel Tower example page is open with its offline archives
    When I drive the shared WebGPU renderer with map events
    Then map events render in the same tick, updates share one animation frame and each frame writes uniforms once

  @webgpu
  Scenario: The roof atlas is composed on the GPU from raster tile textures
    Given the Eiffel Tower example page is open with its offline archives
    When I rebuild the WebGPU roof atlas
    Then the roof atlas matches its raster tiles without uploading a canvas

  @webgpu
  Scenario: Terrain tiles are uploaded on arrival and follow the projected DEM grid
    Given the Eiffel Tower example page is open with its offline archives
    When I inspect the WebGPU terrain tiles
    Then terrain tiles are uploaded before rendering and match the projected DEM grid
