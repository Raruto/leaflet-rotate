Feature: Rotating a Leaflet map
  Background:
    Given the example page is open

  @issue-4 @issue-35 @issue-62
  Scenario: Rotated road labels stay upright and aligned with the map
    When I rotate a label marker with the view
    Then the label remains upright while following the map bearing

  @issue-2 @issue-54
  Scenario: GeoJSON in a custom pane rotates with the map
    When I add GeoJSON to a custom pane inside the rotate pane
    Then the custom-pane GeoJSON stays aligned with its coordinates

  @issue-32
  Scenario: Canvas overlays rotate with the map
    When I render a Canvas vector layer on a rotated map
    Then the Canvas renderer belongs to the rotating pane

  @issue-57
  Scenario: SVG paths stay aligned near the latitude limit without zoom animation
    When I zoom an SVG path near the latitude limit
    Then the path stays at its geographic coordinate

  @issue-15 @issue-51
  Scenario: Popup tip remains anchored when zoom animation is disabled
    When I open a popup on a rotated map without zoom animation
    Then the popup tip stays at the marker coordinate

  @issue-23
  Scenario: Removing the rotate control detaches its map listener
    When I remove the rotate control and change the map bearing
    Then the map rotates without invoking the removed control

  @issue-3
  Scenario: Markers remain non-draggable unless requested
    When I create default and draggable markers
    Then only the requested marker is draggable

  @issue-46
  Scenario: Click coordinates match the rotated map location
    When I click a rotated map at a known container point
    Then the click event reports the matching geographic coordinate

  @issue-18 @issue-59
  Scenario: Focusing an in-bounds marker does not pan the rotated map
    When I focus a marker near the edge of a rotated map
    Then the map center remains unchanged

  @issue-51
  Scenario: Opening an edge popup pans only enough to keep it visible
    When I open a popup near the edge of a rotated map
    Then the popup stays inside the map without a large jump

  @issue-52
  Scenario: Opening a popup in a second rotated map does not move it
    When I open a popup in a second rotated map with map listeners
    Then the second map center remains unchanged and its popup stays anchored
