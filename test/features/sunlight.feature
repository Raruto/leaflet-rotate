@3d-layer @sunlight
Feature: Visible solar time control
  Scenario: Current time is the default and the slider previews the selected UTC day
    Given the Eiffel Tower example page is open with its offline archives
    Then the solar control starts at current time and its slider controls the sunlight

  Scenario: Daytime casts actual shadows and night removes direct lighting
    Given the Eiffel Tower example page is open with its offline archives
    Then solar lighting and depth shadows follow the time slider

  Scenario: Sky, terrain, sun and moon follow the selected time and viewing direction
    Given the Eiffel Tower example page is open with its offline archives
    Then sky and terrain change from day to night and celestial bodies follow the camera
