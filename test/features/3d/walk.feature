@3d-layer @walk
Feature: Third-person walk mode
  Scenario: The keyboard walks a pedestrian over a bridge deck while dragging only turns the camera and buildings block it
    Given the Eiffel Tower example page is open with its offline archives
    Then the walk layer moves the pedestrian on Pont d'Iéna, stops it at walls and Esc restores the map
