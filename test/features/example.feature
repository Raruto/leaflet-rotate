Feature: Rotating a Leaflet map
  Background:
    Given the example page is open

  @issue-55 @issue-58
  Scenario: Leaflet heat redraws stay aligned after map rotation
    When I redraw a heat layer after rotating, panning, and zooming
    Then the heat points remain aligned with their coordinates

  @issue-11
  Scenario: The default rotate control appears only when the map is rotated
    When I rotate a map with the default rotate control
    Then the default rotate control visibility follows the bearing

  @issue-13
  Scenario: Dragging the rotate control changes the map bearing and pitch
    When I drag the rotate control
    Then the map bearing and pitch follow the control drag

  Scenario: Clicking the rotate control resets bearing and pitch
    When I click the rotate control on a rotated and pitched map
    Then the map animates back to north and zero pitch

  @issue-44
  Scenario: Enabling compass bearing requests device-orientation permission
    When I enable compass bearing on a permission-based device
    Then device-orientation permission is requested

  @issue-7
  Scenario: Compass headings handle absolute, iOS, and unavailable readings
    When I apply compass heading readings
    Then valid compass readings update bearing and invalid readings are ignored

  @issue-33 @issue-41
  Scenario: Shift-wheel rotation can be disabled without disabling wheel zoom
    When I use shift-wheel rotation with the handler disabled
    Then shift-wheel input zooms without changing the map bearing

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
