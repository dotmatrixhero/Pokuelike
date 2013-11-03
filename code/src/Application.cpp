#include "../include/Application.hpp"
#include "../include/TestState.hpp"

Application::Application()
{
    TCODConsole::initRoot(80, 50, "Main Window", false, TCOD_RENDERER_OPENGL);
    quit = false;

    registerStates();
}

void Application::registerStates()
{
    stateStack.registerState<TestState>(States::Test);
}

void Application::run(States::ID initialState)
{
    stateStack.pushState(States::Test);
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
