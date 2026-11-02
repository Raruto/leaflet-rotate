Feature: Traffic lanes, flows and timetables

  @3d-layer @seine-cruises
  Scenario: Tourist boats follow the simulation clock and seasonal Paris timetable
    Given the Eiffel Tower example page is open with its offline archives
    Then cruise boats move along the river on scheduled trips and clean up when disabled

  @unit
  Scenario Outline: Vehicle count follows the measured flow
    Then a 300 m lane with <flow> vehicles per hour at <speed> m/s holds <count> vehicles

    Examples:
      | flow | speed | count |
      | 0    | 8     | 0     |
      | 1200 | 8     | 13    |
      | 960  | 16    | 5     |

  @unit
  Scenario: Busier lanes hold proportionally more vehicles, all inside the lane
    Then a 300 m lane holds more than 3 times the vehicles at 1600 than at 400 vehicles per hour
    And every vehicle of a 300 m lane at 900 vehicles per hour lies inside the lane

  @unit
  Scenario: Vehicles interpolate position, ground height and heading along a lane
    Then along a lane 50 m from the start is at x 50, height 15, z 0 heading east
    And along a flat lane 125 m from the start is at x 100, height 0, z 25 heading north

  @unit
  Scenario Outline: Unpublished Paris counting hours fall back to the same weekday and hour
    Then the Paris counting hour for "<time>" is "<hour>"

    Examples:
      | time                 | hour                     |
      | 2026-11-01T17:40:00Z | 2026-11-01T17:00:00.000Z |
      | 2026-11-02T12:59:00Z | 2026-10-26T12:00:00.000Z |
      | nope                 | error                    |

  @unit
  Scenario Outline: Seasonal cruise departures follow Paris local time
    Then at "<time>" the cruises in service are "<departures>"

    Examples:
      | time                 | departures   | note                       |
      | 2026-11-02T09:14:59Z |              | before the first winter boat |
      | 2026-11-02T09:15:00Z | 10:15        | first winter boat departs  |
      | 2026-11-02T10:00:00Z | 10:15, 11:00 |                            |
      | 2026-11-02T10:15:00Z | 11:00        |                            |
      | 2026-06-21T08:30:00Z | 10:00, 10:30 | summer: every 30 minutes   |
      | 2026-11-02T21:29:59Z | 21:30        | last boat about to arrive  |
      | 2026-11-02T21:30:00Z |              |                            |
      | 2026-11-02T02:00:00Z |              | night                      |
      | 2026-10-24T20:30:00Z | 22:00        | October Saturday late boat |
      | 2026-10-23T20:30:00Z |              | not on Fridays             |
      | 2026-03-28T09:15:00Z | 10:15        | winter time                |
      | 2026-03-29T08:15:00Z | 10:15        | after the DST change       |
      | 2026-10-24T08:00:00Z | 10:00        | summer time                |
      | 2026-10-25T09:00:00Z | 10:00        | after the DST change       |

  @unit
  Scenario: Cruise trips report progress and reject invalid dates
    Then the cruise departing at "10:00" is halfway at "2026-06-21T08:30:00Z"
    And cruise progress grows from "2026-06-21T09:10:00Z" to "2026-06-21T09:10:01Z"
    And cruises at "invalid" fail with "Invalid date"

  @unit
  Scenario: The cruise route is a closed loop on the Seine in central Paris
    Then the cruise route ends where it starts
    And the cruise route is between 10 and 16 km long
    And the cruise route stays between latitudes 48.849 and 48.865 and longitudes 2.285 and 2.362
