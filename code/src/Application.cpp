#include "../include/Application.hpp"

#include "../include/TestState.hpp"
#include "../include/DebugState.hpp"
#include "../include/TitleState.hpp"
#include "../include/GameState.hpp"

Application::Application()
{
    TCODConsole::initRoot(100, 100, "Main Window", false, TCOD_RENDERER_OPENGL);
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
