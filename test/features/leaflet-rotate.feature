Feature: Rotating a Leaflet map
  Background:
    Given the example page is open

  Scenario: Rotation is enabled
    Then rotation is enabled on the map

  Scenario: Bearing survives zoom
    When I set the bearing to 10 and zoom in twice
    Then the bearing remains 10

  Scenario: Bearing survives setting the view
    When I set the bearing to 10 and change the view twice
    Then the bearing remains 10

  Scenario: Fit bounds zoom is stable
    When I fit the same bounds twice
    Then the map zoom is 14 both times

  Scenario: Panning inside a marker keeps its bounds stable
    When I pan inside the Trondheim marker
    Then panning inside keeps the expected bounds

  Scenario: Draggable marker listeners are not duplicated
    Then the draggable marker has one drag listener and one drag-end listener
