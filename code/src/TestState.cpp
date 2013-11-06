#include "../include/TestState.hpp"
#include "../include/StateIdentifiers.hpp"

TestState::TestState(StateStack& stateStack)
    : State(stateStack)
{
    thingx = 10;
    thingy = 10;
}

TestState::~TestState()
{
}

void TestState::draw()
{
    TCODConsole::root->print(11, 10, "ELLO LIBTCOD WORLD!");
    TCODConsole::root->print(thingx, thingy, "H");

    int x = 2, y = 15;
    TCODLine::init(x,y,74,37);
    do
    {
        TCODConsole::root->setChar(x, y, 'o');
    } while (!TCODLine::step(&x,&y));
}

bool TestState::update()
{
    return false;
}

bool TestState::handleInput(TCOD_key_t key)
{
    if (key.vk == TCODK_UP)
        thingy -= 1;
    else if (key.vk == TCODK_DOWN)
        thingy += 1;
    else if (key.vk == TCODK_LEFT)
        thingx -= 1;
    else if (key.vk == TCODK_RIGHT)
        thingx += 1;
    else if (key.c == 'a')
        requestStackPush(States::Debug);
    return false;
}
