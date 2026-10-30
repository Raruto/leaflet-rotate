@eiffel
Feature: Eiffel Tower 3D example
  Scenario: The real Eiffel Tower model follows the map camera
    Given the Eiffel Tower example page is open
    When I visit and inspect the Eiffel Tower 3D model
    Then the tower is rendered at its geographic position through camera changes
