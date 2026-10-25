Feature: Rotating a Leaflet map
  Background:
    Given the example page is open

  @issue-58
  Scenario: Leaflet heat redraws stay aligned after map rotation
    When I redraw a heat layer after rotating, panning, and zooming
    Then the heat points remain aligned with their coordinates

  @debugger
  Scenario: Debugger rotation presets and keyboard slider stay synchronized
    When I use the debugger rotation controls
    Then every debugger rotation control matches the map bearing

  @debugger
  Scenario: Debugger bounds padding updates from the keyboard
    When I change the debugger bounds padding from the keyboard
    Then the displayed bounds use the selected padding

  @debugger
  Scenario: Debugger geometry follows an offset and resized map
    When I inspect debugger geometry after resizing and moving the map
    Then the debugger reports the current map geometry

  @example-ui
  Scenario: Example base-layer radios select one layer
    When I switch between the example base layers
    Then exactly the selected base layer is visible

  @example-ui
  Scenario: Example zoom controls change and restore the zoom
    When I use the example zoom controls
    Then the zoom returns to its starting level

  @example-ui
  Scenario: Debugger rotates all example markers
    When I rotate the example markers from the debugger
    Then every example marker has a new rotation

  @example-ui
  Scenario Outline: Example destination buttons fly to the selected place
    When I select "<place>" from the example page
    Then the map settles at "<place>" at zoom 10

    Examples:
      | place          |
      | Kyiv           |
      | London         |
      | San Francisco  |
      | Washington     |
      | Trondheim      |

  @example-ui
  Scenario Outline: Example bounds buttons fit the selected layer
    When I fit the "<layer>" bounds from the example page
    Then the map view contains the "<layer>" bounds

    Examples:
      | layer   |
      | circle  |
      | polygon |
      | path    |

  @example-ui
  Scenario: Rectangle button resets zoom and fits the rectangle
    When I fit the rectangle from the example page
    Then the rectangle is fitted at zoom 14
