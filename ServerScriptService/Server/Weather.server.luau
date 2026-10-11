local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)

local weatherStates = {}
for stateName in Config.Weather.States do
	table.insert(weatherStates, stateName)
end

table.sort(weatherStates)
workspace:SetAttribute("MountRillWeather", Config.Weather.StartingState)

if Config.Weather.StateChangeInterval <= 0 or #weatherStates < 2 then
	return
end

local currentIndex = table.find(weatherStates, Config.Weather.StartingState) or 1
while true do
	task.wait(Config.Weather.StateChangeInterval)
	currentIndex = currentIndex % #weatherStates + 1
	workspace:SetAttribute("MountRillWeather", weatherStates[currentIndex])
end
