@3d-layer @seine-cruises
Feature: Scheduled Seine sightseeing boats
  Scenario: Tourist boats follow the simulation clock and seasonal Paris timetable
    Given the Eiffel Tower example page is open with its offline archives
    Then cruise boats move along the river on scheduled trips and clean up when disabled
