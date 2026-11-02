Feature: Pitched map rendering without a 3D renderer
  Background:
    Given a standalone pitched map is open

  Scenario: Raster layers restore perspective after toggling and late attachment
    Then raster perspective follows pitch on late and reattached layers

  Scenario: Pitched raster surfaces and markers remain visible after camera changes and compass reset
    Then pitched raster surfaces draw loaded tiles after rapid camera changes

  Scenario: Raster tile levels follow the first camera change after accumulated pans
    Then raster tiles remain aligned after panning before their first pitch change

  Scenario: Resetting a pitched view after animated zoom restores the ground camera
    Then pitched view resets preserve the ground perspective after accumulated pans
