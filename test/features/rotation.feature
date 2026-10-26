Feature: Rotating a Leaflet map
  Background:
    Given the example page is open

  @issue-43
  Scenario: Rotation is enabled
    Then rotation is enabled on the map

  @issue-19
  Scenario: Bearing survives zoom
    When I set the bearing to 10 and zoom in twice
    Then the bearing remains 10

  @issue-19
  Scenario: Bearing survives setting the view
    When I set the bearing to 10 and change the view twice
    Then the bearing remains 10

  @issue-63
  Scenario: Bearing can animate
    When I animate the bearing to 90 degrees
    Then the bearing reaches 90 degrees gradually

  Scenario: Pitch projects and reverses map coordinates
    When I set the map pitch to 45 degrees
    Then map coordinates stay consistent with the pitched view

  Scenario: Ctrl-drag changes pitch and bearing without panning
    When I change pitch and bearing with Ctrl-drag
    Then pitch and bearing change without moving the map pane

  Scenario: Pitched vector layers stay aligned while panning
    When I drag the pitched map
    Then vector layers stay aligned with their map coordinates

  Scenario: Vector layers stay aligned after off-center zoom and rotation
    When I zoom off-center then rotate the map
    Then vector layers stay aligned with their map coordinates

  Scenario: Ctrl-drag after panning keeps the map center stable
    When I pan the map then Ctrl-drag
    Then the map center stays stable during Ctrl-drag

  Scenario: Ctrl-drag cancels a pending wheel zoom
    When I Ctrl-drag while a wheel zoom is pending
    Then the pending wheel zoom does not move the map

  @issue-25
  Scenario: Fit bounds zoom is stable
    When I fit the same bounds twice
    Then the map zoom is 14 both times

  @issue-28
  Scenario: Panning inside a marker keeps its bounds stable
    When I pan inside the Trondheim marker
    Then panning inside keeps the expected bounds

  @issue-34
  Scenario: Draggable marker listeners are not duplicated
    Then the draggable marker has one drag listener and one drag-end listener
