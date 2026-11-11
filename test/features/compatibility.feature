Feature: Leaflet 1.9 and 2 beta module compatibility
  Scenario Outline: Modules work with a global Leaflet namespace
    Given the plugin is loaded as an ES module from "<entry>"
    Then rotation, pitch and DOM positioning work with a global Leaflet namespace

    Examples:
      | entry                        |
      | src/index.js                 |
      | dist/leaflet-rotate.mjs       |

  Scenario: Pinch zoom can be toggled through the supported Leaflet handler
    Given the example page is open
    Then the pinch zoom handler controls only the shared zoom gesture
