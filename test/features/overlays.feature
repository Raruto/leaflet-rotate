Feature: Rotating a Leaflet map
  Background:
    Given the example page is open

  @issue-62
  Scenario: Rotated road labels stay upright and aligned with the map
    When I rotate a label marker with the view
    Then the label remains upright while following the map bearing

  @issue-57
  Scenario: SVG paths stay aligned near the latitude limit without zoom animation
    When I zoom an SVG path near the latitude limit
    Then the path stays at its geographic coordinate

  @issue-51
  Scenario: Popup tip remains anchored when zoom animation is disabled
    When I open a popup on a rotated map without zoom animation
    Then the popup tip stays at the marker coordinate

  @issue-51
  Scenario: Opening an edge popup pans only enough to keep it visible
    When I open a popup near the edge of a rotated map
    Then the popup stays inside the map without a large jump

  @issue-52
  Scenario: Opening a popup in a second rotated map does not move it
    When I open a popup in a second rotated map with map listeners
    Then the second map center remains unchanged and its popup stays anchored
