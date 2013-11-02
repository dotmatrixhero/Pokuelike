#include <stdio.h>
#include <libtcod.hpp>

int main()
{
	TCODConsole::initRoot(80, 50, "I hope this works");
	bool endGame = false;

	while (!endGame && !TCODConsole::isWindowClosed())
	  {
	    TCODConsole::flush();
	    TCOD_key_t key = TCODConsole::waitForKeypress(true);
	  }
	return 0;
}
