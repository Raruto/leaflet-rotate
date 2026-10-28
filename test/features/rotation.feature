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

  @issue-72
  Scenario: Pitch projects and reverses map coordinates
    When I set the map pitch to 45 degrees
    Then map coordinates stay consistent with the pitched view

  @issue-72
  Scenario: Ctrl-drag changes pitch and bearing without panning
    When I change pitch and bearing with Ctrl-drag
    Then pitch and bearing change without moving the map pane

  @issue-72
  Scenario: Pitched vector layers stay aligned while panning
    When I drag the pitched map
    Then vector layers stay aligned with their map coordinates

  @issue-72
  Scenario: Vector layers stay aligned after off-center zoom and rotation
    When I zoom off-center then rotate the map
    Then vector layers stay aligned with their map coordinates

  @issue-72
  Scenario: Ctrl-drag after panning keeps the map center stable
    When I pan the map then Ctrl-drag
    Then the map center stays stable during Ctrl-drag

  @issue-72
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

  @issue-72
  Scenario: Vector layers do not jump when zooming from a low level
    When I animate a zoom from a low level on a rotated map
    Then vector layers do not jump at the end of the zoom animation

  @issue-72
  Scenario: Wheel zoom keeps the cursor point on a pitched map
    When I zoom around an off-center point on a pitched map
    Then the point under the cursor stays in place

  @issue-72
  Scenario: Right-drag rotates around the map center
    When I right-drag horizontally below the map center
    Then the map rotates counterclockwise without opening the context menu

  @issue-72
  Scenario: High pitch keeps tile loading bounded
    When I look at a high zoom map with a high pitch
    Then tile loading stays bounded and covers the visible map

  @issue-72
  Scenario: Tiles stay aligned after panning and changing pitch
    When I pan, zoom and change the pitch of a rotated map
    Then the map is centered and the tiles stay aligned with the map coordinates