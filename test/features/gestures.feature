Feature: Rotating a Leaflet map
  Background:
    Given the example page is open

  @issue-43
  Scenario: Pinch zoom refreshes paths during the gesture
    When I move a two-finger pinch gesture
    Then the zoom transition ends before the gesture ends

  Scenario: Two fingers dragged vertically change the pitch, pinching does not
    When I drag two fingers vertically and then pinch with touch pitch enabled
    Then only the vertical two-finger drag changes the pitch

  @issue-43
  Scenario: Vector paths follow a rotated two-finger gesture
    When I rotate and zoom two fingers over a vector path
    Then the vector path remains aligned during the gesture

  @issue-56
  Scenario: Dragging a max-bounds marker preserves callback coordinates on a rotated map
    When I drag a constrained marker on a rotated map
    Then its drag callbacks match the marker and pointer coordinates

  @issue-60
  Scenario: Interactive layers stay aligned while dragging and rotating the map
    When I drag a map with interactive layers while rotated
    Then the marker and vector path stay at their geographic coordinates

  @issue-59 @issue-52
  Scenario: Focusing an in-bounds point does not pan an offset rotated map
    When I focus a point near the left edge of an offset map
    Then the map center remains unchanged

  @issue-65
  Scenario: Two-finger rotation can be disabled
    When I disable touch rotation and rotate two fingers
    Then the map bearing remains unchanged
