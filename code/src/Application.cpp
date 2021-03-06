#include "../include/Application.hpp"

#include "../include/TestState.hpp"
#include "../include/DebugState.hpp"
#include "../include/TitleState.hpp"
#include "../include/GameState.hpp"

Application::Application()
{
    // We'll probably use this line soon.
    // TCODConsole::setCustomFont("terminal8x8_aa_tc.png", TCOD_FONT_LAYOUT_TCOD);

    TCODConsole::initRoot(DEFAULT_WIDTH, DEFAULT_HEIGHT,
                          "Main Window",
                          false,
                          TCOD_RENDERER_OPENGL);
    TCODConsole::root->setDefaultBackground(TCODColor::black);
    quit = false;

    registerStates();
}

Application::Application(const std::string& filename)
{
    TCODParser parser;
    TCODParserStruct* app = parser.newStructure("Application");
    app->addProperty("Width",  TCOD_TYPE_INT, true);
    app->addProperty("Height", TCOD_TYPE_INT, true);

    parser.run(filename.c_str(), nullptr);

    int width = parser.getIntProperty("Width");
    int height = parser.getIntProperty("Height");
    TCODConsole::initRoot(width, height,
                          "Main Window",
                          false,
                          TCOD_RENDERER_OPENGL);

    TCODConsole::root->setDefaultBackground(TCODColor::black);
    quit = false;

    registerStates();
}

void Application::registerStates()
{
    stateStack.registerState<TestState>(States::Test);
    stateStack.registerState<DebugState>(States::Debug);
    stateStack.registerState<GameState>(States::Game);
    stateStack.registerState<TitleState>(States::Title);
}

void Application::run(States::ID initialState)
{
    stateStack.pushState(initialState);
    stateStack.applyPendingStateChanges();

    while (!quit && !TCODConsole::isWindowClosed())
    {
        TCODConsole::root->clear();
        stateStack.draw();
        TCODConsole::flush();

        TCOD_key_t key;
        TCODSystem::waitForEvent(TCOD_EVENT_KEY_PRESS,&key,NULL,true);
        stateStack.handleInput(key);

        stateStack.update();
    }
}

















