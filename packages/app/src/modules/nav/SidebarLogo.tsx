import {
  Link,
  sidebarConfig,
  useSidebarOpenState,
} from '@backstage/core-components';
import { makeStyles } from '@material-ui/core';
import { LogoFull } from './LogoFull';
import { LogoIcon } from './LogoIcon';
import brandLogoFull from './assets/devops-project-logo-full.png';
import brandLogoIcon from './assets/devops-project-logo-icon.png';

const useSidebarLogoStyles = makeStyles({
  root: {
    width: sidebarConfig.drawerWidthClosed,
    height: 3 * sidebarConfig.logoHeight,
    display: 'flex',
    flexFlow: 'column nowrap',
    justifyContent: 'center',
    marginBottom: -14,
  },
  link: {
    width: sidebarConfig.drawerWidthClosed,
    marginLeft: 24,
  },
  brandChipFull: {
    background: '#fff',
    borderRadius: 6,
    padding: '6px 10px',
    marginLeft: 24,
    marginTop: 10,
    display: 'inline-flex',
    width: 'fit-content',
  },
  brandChipIcon: {
    background: '#fff',
    borderRadius: 6,
    padding: '4px 6px',
    marginLeft: 24,
    marginTop: 10,
    display: 'inline-flex',
    width: 'fit-content',
  },
  brandFull: {
    height: 20,
    width: 'auto',
    display: 'block',
  },
  brandIcon: {
    height: 18,
    width: 'auto',
    display: 'block',
  },
});

export const SidebarLogo = () => {
  const classes = useSidebarLogoStyles();
  const { isOpen } = useSidebarOpenState();

  return (
    <div className={classes.root}>
      <Link to="/" underline="none" className={classes.link} aria-label="Home">
        {isOpen ? <LogoFull /> : <LogoIcon />}
      </Link>
      <div className={isOpen ? classes.brandChipFull : classes.brandChipIcon}>
        <img
          src={isOpen ? brandLogoFull : brandLogoIcon}
          alt="Devops Project"
          className={isOpen ? classes.brandFull : classes.brandIcon}
        />
      </div>
    </div>
  );
};
