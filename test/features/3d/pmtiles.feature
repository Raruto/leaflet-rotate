@3d-layer
Feature: Native PMTiles archives
  Scenario: PMTiles layer methods handle range archives without external libraries
    Given a map with the standalone 3D module and no dependency import map
    Then the native PMTiles methods handle directories, compression and failures

  Scenario: PMTiles layers initialize their archives
    Given a map with the standalone 3D module and no dependency import map
    Then PMTiles layers own archive initialization and native zoom selection
