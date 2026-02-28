const CONFIG = {
    players: [
        {
            id: "p1",
            name: "rayder",
            legends: []
        },
        {
            id: "p2",
            name: "Admin",
            legends: []
        },
        {
            id: "p3",
            name: "MrLeeS",
            legends: []
        }
    ],
    allLegendNames: [
        "Bangalore", "Revenant", "Fuse", "Mad Maggie", "Ballistic",
        "Pathfinder", "Wraith", "Octane", "Horizon", "Ash", "Alter",
        "Bloodhound", "Crypto", "Valkyrie", "Seer", "Vantage", "Sparrow",
        "Gibraltar", "Lifeline", "Mirage", "Loba", "Newcastle", "Conduit",
        "Caustic", "Wattson", "Rampart", "Catalyst",
    ]
};

const CONFIG = {
    players: [
        { id: "p1", name: "rayder", legends: [] },
        { id: "p2", name: "Admin", legends: [] },
        { id: "p3", name: "MrLeeS", legends: [] }
    ],

    classes: {
        "Assault": ["Bangalore", "Revenant", "Fuse", "Mad Maggie", "Ballistic"],
        "Skirmisher": ["Pathfinder", "Wraith", "Octane", "Horizon", "Ash", "Alter"],
        "Recon": ["Bloodhound", "Crypto", "Valkyrie", "Seer", "Vantage", "Sparrow"],
        "Support": ["Gibraltar", "Lifeline", "Mirage", "Loba", "Newcastle", "Conduit"],
        "Controller": ["Caustic", "Wattson", "Rampart", "Catalyst"],
    },

    classIcons: {
        "Assault": "🔥",
        "Skirmisher": "🚀",
        "Recon": "👁️",
        "Support": "➕",
        "Controller": "🛡️"
    }
};