@paris-buildings
Feature: Paris building volumes
  Scenario: Visible building volumes render with holes and estimated storey heights
    Given the Paris buildings example is open with sample volumes
    Then the building volumes preserve courtyards and elevated floors
    When I move and toggle the Paris building volumes
    Then building requests follow the viewport and recover from failures
